async function callThunderCat(command) {
  let background = null;

  try {
    background = await messenger.runtime.getBackgroundPage();
  } catch (_) {
    background = null;
  }

  if (
    background &&
    background.ThunderCatAPI &&
    typeof background.ThunderCatAPI[command] === "function"
  ) {
    return background.ThunderCatAPI[command]();
  }

  // Fallback auf normales Runtime-Messaging.
  try {
    return await messenger.runtime.sendMessage({
      command,
    });
  } catch (error) {
    throw new Error(
      "ThunderCat-Hintergrunddienst ist nicht erreichbar. " +
      "Bitte Thunderbird einmal neu starten oder das Add-on " +
      "deaktivieren und wieder aktivieren. Technischer Fehler: " +
      (error?.message || String(error))
    );
  }
}


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
  openaiModel: "gpt-4o-mini",
  minConfidence: 0.72,
  batchSize: 20,
  scanLimit: 2000,
  selectedAccountIds: [],
};

let currentMappings = {};
let currentAccounts = [];

const $ = selector => document.querySelector(selector);

function getBaseDomain(input) {
  let value = String(input || "").trim().toLowerCase();

  if (value.includes("@")) {
    value = value.split("@").pop();
  }

  value = value.replace(/^\.+|\.+$/g, "");

  return value || "unbekannt";
}

function showStatus(selector, text, isError = false) {
  const node = $(selector);
  node.textContent = text;
  node.style.color = isError ? "crimson" : "";
}

function getSettingsFromForm() {
  const selectedAccountIds = Array.from(
    document.querySelectorAll(".account-select:checked")
  ).map(input => input.value);

  return {
    enabled: $("#enabled").checked,
    processNewMail: $("#processNewMail").checked,
    autoCreateFolders: $("#autoCreateFolders").checked,
    includeSubfolders: $("#includeSubfolders").checked,
    provider: $("#provider").value,
    mistralApiKey: $("#mistralApiKey").value.trim(),
    mistralModel: $("#mistralModel").value.trim() || "mistral-small-latest",
    openaiApiKey: $("#openaiApiKey").value.trim(),
    openaiModel: $("#openaiModel").value.trim() || "gpt-6-luna",
    minConfidence: Math.min(
      1,
      Math.max(0, Number($("#minConfidence").value || 0.72))
    ),
    batchSize: Math.min(
      50,
      Math.max(1, Number($("#batchSize").value || 20))
    ),
    scanLimit: Math.min(
      20000,
      Math.max(1, Number($("#scanLimit").value || 2000))
    ),
    selectedAccountIds,
  };
}

function fillSettings(settings) {
  $("#enabled").checked = Boolean(settings.enabled);
  $("#processNewMail").checked = Boolean(settings.processNewMail);
  $("#autoCreateFolders").checked = Boolean(settings.autoCreateFolders);
  $("#includeSubfolders").checked = Boolean(settings.includeSubfolders);
  $("#provider").value = settings.provider || "mistral";
  $("#mistralApiKey").value = settings.mistralApiKey || "";
  $("#mistralModel").value = settings.mistralModel || "mistral-small-latest";
  $("#openaiApiKey").value = settings.openaiApiKey || "";
  $("#openaiModel").value = settings.openaiModel || "gpt-6-luna";
  $("#minConfidence").value = settings.minConfidence ?? 0.72;
  $("#batchSize").value = settings.batchSize ?? 20;
  $("#scanLimit").value = settings.scanLimit ?? 2000;

  renderProvider();
  renderAccounts(settings.selectedAccountIds || []);
}

function renderProvider() {
  const provider = $("#provider").value;
  $("#mistralBlock").style.display =
    provider === "mistral" ? "" : "none";
  $("#openaiBlock").style.display =
    provider === "openai" ? "" : "none";
}

function renderAccounts(selectedIds = []) {
  const container = $("#accounts");
  container.textContent = "";

  for (const account of currentAccounts) {
    const row = document.createElement("label");
    row.className = "account-row check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "account-select";
    checkbox.value = account.id;
    checkbox.checked = selectedIds.includes(account.id);

    const label = document.createTextNode(
      ` ${account.name || account.id} (${account.type || "Mail"})`
    );

    row.append(checkbox, label);
    container.appendChild(row);
  }
}

function mappingEntries() {
  return Object.entries(currentMappings)
    .sort(([a], [b]) => a.localeCompare(b));
}

function renderMappings() {
  const search = $("#mappingSearch").value.trim().toLowerCase();
  const container = $("#mappingTable");
  container.textContent = "";

  const entries = mappingEntries().filter(([email, item]) => {
    if (!search) return true;

    return (
      email.toLowerCase().includes(search) ||
      String(item.domain || "").toLowerCase().includes(search) ||
      String(item.category || "").toLowerCase().includes(search)
    );
  });

  if (!entries.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Keine passenden Zuordnungen vorhanden.";
    container.appendChild(p);
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Absender</th>
      <th>Domain</th>
      <th>Kategorie</th>
      <th>Sicherheit</th>
      <th>Quelle</th>
      <th></th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  for (const [email, item] of entries) {
    const tr = document.createElement("tr");

    const tdEmail = document.createElement("td");
    tdEmail.textContent = email;

    const tdDomain = document.createElement("td");
    tdDomain.textContent = item.domain || "";

    const tdCategory = document.createElement("td");
    const select = document.createElement("select");

    for (const category of CATEGORIES) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      option.selected = category === item.category;
      select.appendChild(option);
    }

    select.addEventListener("change", async () => {
      currentMappings[email] = {
        ...currentMappings[email],
        category: select.value,
        confidence: 1,
        source: "manual",
        reason: "Manuell in den ThunderCat-Einstellungen geändert.",
        updatedAt: new Date().toISOString(),
      };

      await messenger.storage.local.set({
        senderMappings: currentMappings,
      });

      renderMappings();
    });

    tdCategory.appendChild(select);

    const tdConfidence = document.createElement("td");
    tdConfidence.textContent =
      `${Math.round(Number(item.confidence || 0) * 100)} %`;

    const tdSource = document.createElement("td");
    tdSource.textContent = item.source || "";

    const tdAction = document.createElement("td");
    const remove = document.createElement("button");
    remove.className = "small-button";
    remove.textContent = "Löschen";

    remove.addEventListener("click", async () => {
      delete currentMappings[email];

      await messenger.storage.local.set({
        senderMappings: currentMappings,
      });

      renderMappings();
    });

    tdAction.appendChild(remove);

    tr.append(
      tdEmail,
      tdDomain,
      tdCategory,
      tdConfidence,
      tdSource,
      tdAction
    );

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

async function saveSettings() {
  const settings = getSettingsFromForm();

  await messenger.storage.local.set({
    settings,
  });

  showStatus(
    "#saveStatus",
    "Einstellungen gespeichert."
  );
}

async function load() {
  currentAccounts = await messenger.accounts.list(false);

  const stored = await messenger.storage.local.get([
    "settings",
    "senderMappings",
  ]);

  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {}),
  };

  currentMappings = stored.senderMappings || {};

  for (const mapping of Object.values(currentMappings)) {
    if (mapping.category === "Webhosting") {
      mapping.category = "Digitales";
    } else if (
      mapping.category === "Sonstiges" ||
      mapping.category === "Spam" ||
      mapping.category === "Unklar" ||
      !CATEGORIES.includes(mapping.category)
    ) {
      mapping.category = "Unsicher";
    }
  }

  await messenger.storage.local.set({
    senderMappings: currentMappings,
  });

  fillSettings(settings);
  renderMappings();
}

$("#provider").addEventListener("change", renderProvider);
$("#mappingSearch").addEventListener("input", renderMappings);

$("#save").addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (error) {
    showStatus("#saveStatus", error.message || String(error), true);
  }
});

$("#testProvider").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await saveSettings();
    showStatus("#providerStatus", "Provider wird getestet …");

    const result = await callThunderCat("testProvider");

    showStatus(
      "#providerStatus",
      `Verbindung erfolgreich: ${result.result.category}, ` +
      `${Math.round(result.result.confidence * 100)} %.`
    );
  } catch (error) {
    showStatus(
      "#providerStatus",
      error.message || String(error),
      true
    );
  } finally {
    button.disabled = false;
  }
});

$("#createFolders").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;

  try {
    await saveSettings();
    showStatus("#folderStatus", "Ordner werden geprüft …");

    const result = await callThunderCat("ensureBaseFolders");

    showStatus(
      "#folderStatus",
      `${result.inboxes} Posteingang/Posteingänge geprüft.`
    );
  } catch (error) {
    showStatus(
      "#folderStatus",
      error.message || String(error),
      true
    );
  } finally {
    button.disabled = false;
  }
});

$("#exportMappings").addEventListener("click", () => {
  const blob = new Blob(
    [JSON.stringify(currentMappings, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "thundercat_sender_mappings.json";
  link.click();
  URL.revokeObjectURL(url);
});

$("#importMappings").addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Ungültige Mapping-Datei.");
    }

    const imported = {};

    for (const [email, item] of Object.entries(parsed)) {
      const normalizedEmail = String(email || "")
        .toLowerCase()
        .trim();
      const category = String(item?.category || "").trim();

      if (!normalizedEmail || !CATEGORIES.includes(category)) {
        continue;
      }

      let confidence = Number(item?.confidence ?? 0);
      if (!Number.isFinite(confidence)) {
        confidence = 0;
      }

      imported[normalizedEmail] = {
        ...currentMappings[normalizedEmail],
        ...item,
        category,
        confidence: Math.min(1, Math.max(0, confidence)),
        domain: String(item?.domain || getBaseDomain(normalizedEmail)),
        updatedAt: item?.updatedAt || new Date().toISOString(),
      };
    }

    currentMappings = {
      ...currentMappings,
      ...imported,
    };

    await messenger.storage.local.set({
      senderMappings: currentMappings,
    });

    renderMappings();

    showStatus(
      "#saveStatus",
      "Zuordnungen importiert."
    );
  } catch (error) {
    showStatus(
      "#saveStatus",
      error.message || String(error),
      true
    );
  } finally {
    event.target.value = "";
  }
});

load().catch(error => {
  showStatus("#saveStatus", error.message || String(error), true);
});
