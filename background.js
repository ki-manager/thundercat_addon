const CATEGORIES = [
  "Arbeit",
  "Finanzen",
  "Shopping",
  "Digitales",
  "Newsletter",
  "Privat",
  "Unsicher",
];

const DEFAULT_SETTINGS = {
  enabled: true,
  processNewMail: true,
  autoCreateFolders: true,
  includeSubfolders: false,
  provider: "mistral",
  mistralApiKey: "",
  mistralModel: "mistral-small-latest",
  openaiApiKey: "",
  openaiModel: "gpt-6-luna",
  minConfidence: 0.72,
  batchSize: 20,
  scanLimit: 2000,
  selectedAccountIds: [],
};

function nowIso() {
  return new Date().toISOString();
}

async function readState() {
  const stored = await messenger.storage.local.get([
    "settings",
    "senderMappings",
    "stats",
    "activity",
  ]);

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {}),
  };

  const senderMappings = stored.senderMappings || {};

  // Migration älterer ThunderCat-Zuordnungen.
  for (const mapping of Object.values(senderMappings)) {
    const oldCategory = String(mapping?.category || "");

    if (oldCategory === "Webhosting") {
      mapping.category = "Digitales";
    } else if (
      oldCategory === "Sonstiges" ||
      oldCategory === "Spam" ||
      oldCategory === "Unklar"
    ) {
      mapping.category = "Unsicher";
    } else if (!CATEGORIES.includes(oldCategory)) {
      mapping.category = "Unsicher";
    }
  }

  return {
    settings,
    senderMappings,
    stats: {
      moved: 0,
      classified: 0,
      createdFolders: 0,
      errors: 0,
      moveRetries: 0,
      failedMoves: 0,
      lastRun: null,
      ...(stored.stats || {}),
    },
    activity: Array.isArray(stored.activity) ? stored.activity : [],
  };
}

async function writeState({ settings, senderMappings, stats, activity }) {
  await messenger.storage.local.set({
    settings,
    senderMappings,
    stats,
    activity,
  });
}

function addActivity(state, entry) {
  state.activity.unshift({
    time: nowIso(),
    ...entry,
  });
  state.activity = state.activity.slice(0, 60);
}

function parseAuthor(author) {
  const raw = String(author || "").trim();
  const angle = raw.match(/<([^<>\s]+@[^<>\s]+)>/i);
  const direct = raw.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
  const email = (angle?.[1] || direct?.[0] || "").toLowerCase().trim();

  let name = raw;
  if (email) {
    name = raw
      .replace(`<${email}>`, "")
      .replace(email, "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .trim();
  }

  return {
    email,
    name,
    domain: email.includes("@") ? email.split("@").pop() : "",
  };
}

function getBaseDomain(input) {
  let value = String(input || "").trim().toLowerCase();

  if (value.includes("@")) {
    value = value.split("@").pop();
  }

  value = value.replace(/^\.+|\.+$/g, "");

  if (!value) {
    return "unbekannt";
  }

  const parts = value.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return value;
  }

  const commonSecondLevel = new Set([
    "co", "com", "net", "org", "gov", "edu", "ac",
  ]);

  const tld = parts.at(-1);
  const second = parts.at(-2);

  if (
    tld.length === 2 &&
    commonSecondLevel.has(second) &&
    parts.length >= 3
  ) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function safeFolderName(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ");

  return cleaned || "unbekannt";
}

function buildClassificationPrompt(items) {
  return `
Du klassifizierst E-Mail-Absender für das Thunderbird-Add-on ThunderCat.

Jeder Absender muss genau einer dieser sieben Kategorien zugeordnet werden:
- Arbeit
- Finanzen
- Shopping
- Digitales
- Newsletter
- Privat
- Unsicher

Definitionen:

Arbeit:
Berufliche Kommunikation, Bewerbungen, Recruiter, Jobportale,
Weiterbildung, Schule, Behörden und geschäftliche Projekte.

Finanzen:
Banken, Kreditkarten, Zahlungsdienste, Rechnungen, Zahlungsbelege,
Versicherungen und Krankenkassen.

Shopping:
Bestellungen, Versand, Online-Shops, Händler, Reisen, Hotels,
Tickets, Lieferdienste und Produktkäufe.

Digitales:
Webhosting, Domains, DNS, SSL, Server, Webspace, E-Mail-Hosting,
WordPress, Website-Betrieb, Telekommunikationsanbieter, Mobilfunk,
Internetanbieter, Fernsehen, Streamingdienste und digitale Abos.
Beispiele: goneo, DomainFactory, IONOS, Telekom, Vodafone,
Netflix, Disney+, WOW, Spotify, DAZN.

Newsletter:
Newsletter, Medien-Updates, Social-Media-Updates, Werbung,
Rabattaktionen, Marketing und allgemeine Informationsmails.

Privat:
Echte private Kommunikation zwischen Personen, Familie und Freunden.

Unsicher:
Fragwürdige, unbekannte, verdächtige oder als Spam erkannte Nachrichten.
Auch Absender, die keiner der sechs anderen Kategorien zuverlässig
zugeordnet werden können, gehören hierhin.

Regeln:
- Sicherheitsmails eines Shops bleiben Shopping.
- Sicherheitsmails einer Bank oder eines Zahlungsdienstes bleiben Finanzen.
- Sicherheitsmails eines Hosting-, Telekommunikations- oder Streaminganbieters bleiben Digitales.
- Eindeutiger Spam, Phishing oder dubiose Absender gehören zu Unsicher.
- Unbekannte oder nicht zuverlässig klassifizierbare Absender gehören zu Unsicher.
- Bei gemischten Betreffzeilen zählt der überwiegende Zweck des Absenders.
- Gib ausschließlich JSON zurück.
- Für jeden Eingabeeintrag muss genau ein Ergebnis vorhanden sein.
- confidence liegt zwischen 0 und 1.

Eingabe:
${JSON.stringify(items)}

Ausgabeformat:
{
  "results": [
    {
      "email": "adresse@example.de",
      "category": "Shopping",
      "confidence": 0.95,
      "reason": "kurze Begründung"
    }
  ]
}
`.trim();
}

function normalizeAiResult(item, fallbackEmail, minConfidence) {
  let category = String(item?.category || "Unsicher").trim();

  if (!CATEGORIES.includes(category)) {
    category = "Unsicher";
  }

  let confidence = Number(item?.confidence ?? 0);
  if (!Number.isFinite(confidence)) {
    confidence = 0;
  }
  confidence = Math.min(1, Math.max(0, confidence));

  if (confidence < Number(minConfidence || 0)) {
    category = "Unsicher";
  }

  return {
    email: String(item?.email || fallbackEmail || "").toLowerCase().trim(),
    category,
    confidence,
    reason: String(item?.reason || "").trim(),
  };
}

async function classifyWithMistral(items, settings) {
  if (!settings.mistralApiKey) {
    throw new Error("Mistral API-Key fehlt.");
  }

  const response = await fetch(
    "https://api.mistral.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.mistralApiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        model: settings.mistralModel || "mistral-small-latest",
        messages: [
          {
            role: "user",
            content: buildClassificationPrompt(items),
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: Math.max(1200, items.length * 220),
      }),
    }
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(
      `Mistral API ${response.status}: ${detail || response.statusText}`
    );
  }

  const body = await response.json();
  let content = body?.choices?.[0]?.message?.content ?? "";

  if (Array.isArray(content)) {
    content = content
      .map(part => typeof part === "string" ? part : (part?.text || ""))
      .join("");
  }

  const parsed = JSON.parse(content);
  const byEmail = new Map(
    (parsed.results || []).map(item => [
      String(item.email || "").toLowerCase().trim(),
      item,
    ])
  );

  return items.map(item =>
    normalizeAiResult(
      byEmail.get(item.email) || {},
      item.email,
      settings.minConfidence
    )
  );
}

function openAiSchema() {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            email: { type: "string" },
            category: {
              type: "string",
              enum: CATEGORIES,
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
            reason: { type: "string" },
          },
          required: [
            "email",
            "category",
            "confidence",
            "reason",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
}

function extractOpenAiText(body) {
  const parts = [];

  for (const output of body?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && content?.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
}

async function classifyWithOpenAI(items, settings) {
  if (!settings.openaiApiKey) {
    throw new Error("OpenAI API-Key fehlt.");
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.openaiModel || "gpt-6-luna",
        input: buildClassificationPrompt(items),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "thundercat_classification",
            strict: true,
            schema: openAiSchema(),
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(
      `OpenAI API ${response.status}: ${detail || response.statusText}`
    );
  }

  const body = await response.json();
  const text = extractOpenAiText(body);

  if (!text) {
    throw new Error("OpenAI hat keine auswertbare Textantwort geliefert.");
  }

  const parsed = JSON.parse(text);
  const byEmail = new Map(
    (parsed.results || []).map(item => [
      String(item.email || "").toLowerCase().trim(),
      item,
    ])
  );

  return items.map(item =>
    normalizeAiResult(
      byEmail.get(item.email) || {},
      item.email,
      settings.minConfidence
    )
  );
}

async function classifyItems(items, settings) {
  if (settings.provider === "openai") {
    return classifyWithOpenAI(items, settings);
  }

  return classifyWithMistral(items, settings);
}

async function getAccountsWithFolders() {
  return messenger.accounts.list(true);
}

function accountSelected(accountId, settings) {
  const selected = settings.selectedAccountIds || [];
  return selected.length === 0 || selected.includes(accountId);
}

function findInbox(account) {
  const walk = folders => {
    for (const folder of folders || []) {
      if ((folder.specialUse || []).includes("inbox")) {
        return folder;
      }

      const found = walk(folder.subFolders || []);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return walk(account?.rootFolder?.subFolders || []);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
 * Serialisiert alle zustandsverändernden Läufe (Scan, neue Mail,
 * Kontextmenü), damit parallele readState/writeState-Zyklen sich nicht
 * gegenseitig überschreiben.
 */
const taskChain = Promise.resolve();

function runSerialized(task) {
  const run = taskChain.then(task);
  taskChain = run.catch(() => {});
  return run;
}

function formatMoveError(error) {
  const message = String(error?.message || error || "Unbekannter Move-Fehler");
  const status = message.match(/status:\s*(\d+)/i)?.[1];
  return status ? `${message} (Status ${status})` : message;
}

/*
 * Nach einem fehlgeschlagenen MOVE kann eine Nachricht bei IMAP trotzdem
 * bereits im Zielordner liegen. Da Thunderbird einer verschobenen Nachricht
 * eine neue ID zuweist, kann die alte ID nicht direkt im Ziel nachgewiesen
 * werden. Stattdessen: ist die alte ID nicht mehr auffindbar, ist die
 * Nachricht mit hoher Wahrscheinlichkeit bereits verschoben.
 */
async function verifyMessageInTarget(messageId, targetFolderId) {
  try {
    const current = await messenger.messages.get(messageId);

    if (current?.folder?.id === targetFolderId) {
      return true;
    }

    // Nachricht existiert noch am Ursprungsort: der Move ist wirklich
    // fehlgeschlagen.
    return false;
  } catch (error) {
    // Nur ein explizit "nicht gefunden" gilt als bereits verschoben.
    // Andere Fehler (z. B. Verbindungsprobleme) dürfen keinen Erfolg
    // vortäuschen.
    return /not found|does not exist|ungültig|ungültige/i.test(
      String(error?.message || error)
    );
  }
}

async function moveMessageWithRetry(messageId, target, state, options = {}) {
  const isUserAction = Boolean(options.isUserAction);
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const delays = [500, 1100, 1800];
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await messenger.messages.move(
        [messageId],
        target.id,
        { isUserAction }
      );

      return { ok: true, attempt };
    } catch (error) {
      lastError = error;

      // Ein IMAP-Server kann den Move bereits ausgeführt haben, obwohl
      // Thunderbird einen Abbruch meldet. Deshalb erst den Zielordner prüfen.
      await sleep(350);
      if (await verifyMessageInTarget(messageId, target.id)) {
        addActivity(state, {
          type: "move-recovered",
          message: `Move bestätigt trotz Thunderbird-Fehler → ${target.name}`,
        });
        return { ok: true, attempt, recovered: true };
      }

      if (attempt < maxAttempts) {
        state.stats.moveRetries += 1;
        const waitMs = delays[Math.min(attempt - 1, delays.length - 1)];
        addActivity(state, {
          type: "move-retry",
          message: `Move fehlgeschlagen, Versuch ${attempt + 1}/${maxAttempts} in ${waitMs} ms: ${formatMoveError(error)}`,
        });
        await sleep(waitMs);
      }
    }
  }

  state.stats.failedMoves += 1;
  state.stats.errors += 1;
  addActivity(state, {
    type: "move-error",
    message: `Nachricht konnte nicht verschoben werden → ${target.name}: ${formatMoveError(lastError)}`,
  });

  return { ok: false, error: lastError };
}

async function findChildFolder(parentId, childName) {
  const children = await messenger.folders.getSubFolders(
    parentId,
    false
  );

  return children.find(
    child => child.name.toLocaleLowerCase() === childName.toLocaleLowerCase()
  ) || null;
}

async function ensureChildFolder(parentId, childName, state, autoCreate) {
  let child = await findChildFolder(parentId, childName);

  if (child) {
    return child;
  }

  if (autoCreate === false) {
    throw new Error(
      `Ordner fehlt und wird nicht automatisch angelegt: ${childName}`
    );
  }

  child = await messenger.folders.create(
    parentId,
    safeFolderName(childName)
  );

  // IMAP-Server benötigen gelegentlich einen Moment, bis ein frisch angelegter
  // Ordner auch für unmittelbar folgende MOVE/COPY-Kommandos bereitsteht.
  await sleep(700);
  child = await findChildFolder(parentId, childName) || child;

  state.stats.createdFolders += 1;

  addActivity(state, {
    type: "folder",
    message: `Ordner angelegt: ${child.name}`,
  });

  return child;
}

async function ensureCategoryFoldersForInbox(inbox, state) {
  for (const category of CATEGORIES) {
    await ensureChildFolder(inbox.id, category, state, true);
  }
}

async function ensureTargetFolder(inbox, category, domain, state) {
  const autoCreate = Boolean(state.settings.autoCreateFolders);

  const categoryFolder = await ensureChildFolder(
    inbox.id,
    category,
    state,
    autoCreate
  );

  const domainFolder = await ensureChildFolder(
    categoryFolder.id,
    getBaseDomain(domain),
    state,
    autoCreate
  );

  return domainFolder;
}

async function getScanFolders(inbox, includeSubfolders) {
  if (!includeSubfolders) {
    return [inbox];
  }

  const result = [inbox];
  const descendants = await messenger.folders.getSubFolders(
    inbox.id,
    true
  );

  const walk = folders => {
    for (const folder of folders || []) {
      result.push(folder);
      walk(folder.subFolders || []);
    }
  };

  walk(descendants);

  const unique = new Map();
  for (const folder of result) {
    if (folder?.id) {
      unique.set(folder.id, folder);
    }
  }
  return Array.from(unique.values());
}

async function listMessages(folderId, limit) {
  const result = [];
  let page = await messenger.messages.list(folderId);

  while (page) {
    for (const message of page.messages || []) {
      result.push(message);
      if (result.length >= limit) {
        if (page.id) {
          try {
            await messenger.messages.abortList(page.id);
          } catch (_) {}
        }
        return result;
      }
    }

    if (!page.id) {
      break;
    }

    page = await messenger.messages.continueList(page.id);
  }

  return result;
}

function groupMessagesBySender(messages) {
  const groups = new Map();

  for (const message of messages) {
    const parsed = parseAuthor(message.author);

    if (!parsed.email) {
      continue;
    }

    if (!groups.has(parsed.email)) {
      groups.set(parsed.email, {
        email: parsed.email,
        name: parsed.name,
        domain: parsed.domain,
        subjects: [],
        messageIds: [],
        messages: [],
      });
    }

    const group = groups.get(parsed.email);
    group.messageIds.push(message.id);
    group.messages.push(message);

    const subject = String(message.subject || "").trim();
    if (
      subject &&
      !group.subjects.includes(subject) &&
      group.subjects.length < 5
    ) {
      group.subjects.push(subject);
    }
  }

  return groups;
}

async function classifyUnknownGroups(groups, state) {
  const unknown = [];

  for (const group of groups.values()) {
    if (!state.senderMappings[group.email]) {
      unknown.push({
        email: group.email,
        name: group.name,
        domain: group.domain,
        subjects: group.subjects,
      });
    }
  }

  if (unknown.length === 0) {
    return;
  }

  const batchSize = Math.max(
    1,
    Math.min(50, Number(state.settings.batchSize || 20))
  );

  for (let start = 0; start < unknown.length; start += batchSize) {
    const batch = unknown.slice(start, start + batchSize);

    // Ein fehlschlagender Batch (z. B. Rate-Limit) darf die Verarbeitung
    // bereits gelernter Absender nicht blockieren.
    let results;

    try {
      results = await classifyItems(batch, state.settings);
    } catch (error) {
      state.stats.errors += 1;

      addActivity(state, {
        type: "classification-error",
        message: `Batch mit ${batch.length} Absender(n) konnte nicht klassifiziert werden: ${error.message || String(error)}`,
      });

      continue;
    }

    for (const result of results) {
      const original = batch.find(item => item.email === result.email);

      if (!original) {
        continue;
      }

      state.senderMappings[result.email] = {
        category: result.category,
        confidence: result.confidence,
        reason: result.reason,
        domain: getBaseDomain(original.domain),
        source: "ai",
        updatedAt: nowIso(),
      };

      state.stats.classified += 1;

      addActivity(state, {
        type: "classification",
        message:
          `${result.email} → ${result.category} ` +
          `(${Math.round(result.confidence * 100)} %)`,
      });
    }
  }
}

async function moveGroups(groups, inbox, state) {
  let successfulMoves = 0;

  // Absichtlich keine großen IMAP-Move-Batches: einzelne Nachrichten sind
  // langsamer, aber deutlich robuster und lassen sich gezielt wiederholen.
  for (const group of groups.values()) {
    const mapping = state.senderMappings[group.email];

    if (!mapping) {
      continue;
    }

    const category = CATEGORIES.includes(mapping.category)
      ? mapping.category
      : "Unsicher";

    const target = await ensureTargetFolder(
      inbox,
      category,
      group.domain,
      state
    );

    for (const message of group.messages) {
      if (message?.folder?.id === target.id) {
        continue;
      }

      const result = await moveMessageWithRetry(
        message.id,
        target,
        state,
        { isUserAction: false, maxAttempts: 3 }
      );

      if (result.ok) {
        successfulMoves += 1;
        state.stats.moved += 1;
      }

      // Kleine Queue-Pause entlastet IMAP bei vielen direkt aufeinander
      // folgenden MOVE-Kommandos.
      await sleep(180);
    }
  }

  if (successfulMoves > 0) {
    addActivity(state, {
      type: "move",
      message: `${successfulMoves} Nachricht(en) erfolgreich verschoben`,
    });
  }
}

async function processMessagesForInbox(messages, inbox, state) {
  if (!messages?.length) {
    return {
      processed: 0,
      moved: 0,
    };
  }

  const beforeMoved = state.stats.moved;
  const groups = groupMessagesBySender(messages);

  try {
    await classifyUnknownGroups(groups, state);
    await moveGroups(groups, inbox, state);
  } catch (error) {
    state.stats.errors += 1;

    addActivity(state, {
      type: "error",
      message: error.message || String(error),
    });

    throw error;
  } finally {
    state.stats.lastRun = nowIso();
    await writeState(state);
  }

  return {
    processed: messages.length,
    moved: state.stats.moved - beforeMoved,
  };
}

async function scanAllInboxes() {
  return runSerialized(async () => {
    const state = await readState();

    if (!state.settings.enabled) {
      throw new Error("ThunderCat ist deaktiviert.");
    }

    const accounts = await getAccountsWithFolders();
    let processed = 0;
    let moved = 0;
    let scannedFolders = 0;

    for (const account of accounts) {
      if (!accountSelected(account.id, state.settings)) {
        continue;
      }

      const inbox = findInbox(account);
      if (!inbox) {
        continue;
      }

      if (state.settings.autoCreateFolders) {
        await ensureCategoryFoldersForInbox(inbox, state);
      }

      const folders = await getScanFolders(
        inbox,
        Boolean(state.settings.includeSubfolders)
      );

      for (const folder of folders) {
        const messages = await listMessages(
          folder.id,
          Math.max(1, Number(state.settings.scanLimit || 2000))
        );

        const result = await processMessagesForInbox(
          messages,
          inbox,
          state
        );

        processed += result.processed;
        moved += result.moved;
        scannedFolders += 1;
      }
    }

    state.stats.lastRun = nowIso();
    await writeState(state);

    return {
      processed,
      moved,
      scannedFolders,
      includeSubfolders: Boolean(state.settings.includeSubfolders),
      mappings: Object.keys(state.senderMappings).length,
    };
  });
}

async function ensureBaseFolders() {
  return runSerialized(async () => {
    const state = await readState();
    const accounts = await getAccountsWithFolders();
    let inboxes = 0;

    for (const account of accounts) {
      if (!accountSelected(account.id, state.settings)) {
        continue;
      }

      const inbox = findInbox(account);
      if (!inbox) {
        continue;
      }

      await ensureCategoryFoldersForInbox(inbox, state);
      inboxes += 1;
    }

    await writeState(state);

    return {
      inboxes,
      createdFolders: state.stats.createdFolders,
    };
  });
}

async function processIncoming(folder, messageList) {
  return runSerialized(async () => {
    const state = await readState();

    if (
      !state.settings.enabled ||
      !state.settings.processNewMail
    ) {
      return;
    }

    if (!accountSelected(folder.accountId, state.settings)) {
      return;
    }

    const isInbox = (folder.specialUse || []).includes("inbox");

    if (!isInbox) {
      return;
    }

    const messages = messageList?.messages || [];

    if (!messages.length) {
      return;
    }

    try {
      await processMessagesForInbox(messages, folder, state);
    } catch (error) {
      try {
        await messenger.notifications.create({
          type: "basic",
          iconUrl: "icons/thundercat-64.png",
          title: "ThunderCat",
          message: `Neue Mail konnte nicht sortiert werden: ${error.message}`,
        });
      } catch (_) {}
    }
  });
}

async function forceCategoryForSelected(info, category) {
  const selected = info?.selectedMessages?.messages || [];

  if (!selected.length) {
    return;
  }

  return runSerialized(async () => {
    const state = await readState();

    for (const message of selected) {
      const parsed = parseAuthor(message.author);

      if (!parsed.email || !message.folder) {
        continue;
      }

      state.senderMappings[parsed.email] = {
        category,
        confidence: 1,
        reason: "Manuell über Thunderbird-Kontextmenü zugeordnet.",
        domain: getBaseDomain(parsed.domain),
        source: "manual",
        updatedAt: nowIso(),
      };

      const accounts = await messenger.accounts.list(true);
      const account = accounts.find(
        item => item.id === message.folder.accountId
      );

      const inbox = findInbox(account);

      if (!inbox) {
        continue;
      }

      const target = await ensureTargetFolder(
        inbox,
        category,
        parsed.domain,
        state
      );

      const moveResult = await moveMessageWithRetry(
        message.id,
        target,
        state,
        { isUserAction: true, maxAttempts: 3 }
      );

      if (moveResult.ok) {
        state.stats.moved += 1;
        addActivity(state, {
          type: "manual",
          message: `${parsed.email} → ${category}`,
        });
      }
    }

  });
}

async function setupMenus() {
  try {
    await messenger.menus.removeAll();
  } catch (_) {}

  messenger.menus.create({
    id: "thundercat-root",
    title: "ThunderCat",
    contexts: ["message_list"],
  });

  for (const category of CATEGORIES) {
    messenger.menus.create({
      id: `thundercat-category-${category}`,
      parentId: "thundercat-root",
      title: `Zu ${category} lernen`,
      contexts: ["message_list"],
    });
  }
}

async function getStatusForUi() {
  const state = await readState();

  return {
    settings: state.settings,
    stats: state.stats,
    mappingCount: Object.keys(state.senderMappings).length,
    activity: state.activity.slice(0, 12),
  };
}

async function testConfiguredProvider() {
  const state = await readState();

  const testItem = [{
    email: "newsletter@example.com",
    name: "ThunderCat Test",
    domain: "example.com",
    subjects: [
      "Newsletter: Neue Funktionen und 20 Prozent Rabatt",
    ],
  }];

  const result = await classifyItems(
    testItem,
    state.settings
  );

  return {
    ok: true,
    result: result[0],
  };
}

/*
 * Direkte Schnittstelle für Popup und Optionen.
 * runtime.getBackgroundPage() startet/aktiviert die Thunderbird-
 * Background-Page und vermeidet damit den Fehler
 * "Receiving end does not exist", falls der Message-Listener
 * noch nicht aktiv war.
 */
globalThis.ThunderCatAPI = {
  getStatus: getStatusForUi,
  scanInbox: scanAllInboxes,
  ensureBaseFolders,
  testProvider: testConfiguredProvider,
};

/*
 * Runtime-Messaging bleibt als Fallback erhalten.
 * Listener bewusst vor den optionalen Menü-/Mail-Listenern registrieren,
 * damit ein Fehler in einer anderen API nicht die UI-Kommunikation blockiert.
 */
function runtimeMessageListener(message) {
  const command = message?.command;

  if (command === "getStatus") {
    return getStatusForUi();
  }

  if (command === "scanInbox") {
    return scanAllInboxes();
  }

  if (command === "ensureBaseFolders") {
    return ensureBaseFolders();
  }

  if (command === "testProvider") {
    return testConfiguredProvider();
  }

  return undefined;
}

messenger.runtime.onMessage.addListener(
  runtimeMessageListener
);

/*
 * Kontextmenü separat und fehlertolerant registrieren.
 */
try {
  messenger.menus.onClicked.addListener((info) => {
    const prefix = "thundercat-category-";

    if (!String(info.menuItemId).startsWith(prefix)) {
      return;
    }

    const category = String(
      info.menuItemId
    ).slice(prefix.length);

    if (!CATEGORIES.includes(category)) {
      return;
    }

    forceCategoryForSelected(
      info,
      category
    ).catch(error => {
      console.error(
        "ThunderCat Kontextmenü:",
        error
      );
    });
  });
} catch (error) {
  console.error(
    "ThunderCat: Kontextmenü-Listener konnte nicht registriert werden:",
    error
  );
}

/*
 * Neue Mails separat und fehlertolerant registrieren.
 */
try {
  messenger.messages.onNewMailReceived.addListener(
    (folder, messageList) => {
      processIncoming(
        folder,
        messageList
      ).catch(error => {
        console.error(
          "ThunderCat neue Mail:",
          error
        );
      });
    }
  );
} catch (error) {
  console.error(
    "ThunderCat: Mail-Listener konnte nicht registriert werden:",
    error
  );
}

/*
 * Menüs erst nach erfolgreicher Registrierung der UI-Schnittstelle erzeugen.
 */
setupMenus().catch(error => {
  console.error(
    "ThunderCat Menüeinrichtung:",
    error
  );
});

console.info(
  "ThunderCat 6.1.2 Background gestartet."
);
