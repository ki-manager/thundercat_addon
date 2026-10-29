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


const $ = selector => document.querySelector(selector);

function providerLabel(value) {
  return value === "openai"
    ? "ChatGPT / OpenAI API"
    : "Mistral";
}

function showMessage(text, isError = false) {
  const box = $("#message");
  box.textContent = text;
  box.style.color = isError ? "crimson" : "";
}

async function refresh() {
  const status = await callThunderCat("getStatus");

  $("#enabled").textContent = status.settings.enabled
    ? "Aktiv"
    : "Aus";

  $("#provider").textContent = providerLabel(
    status.settings.provider
  );

  $("#mappings").textContent = String(status.mappingCount || 0);
  $("#moved").textContent = String(status.stats.moved || 0);

  const activity = $("#activity");
  activity.textContent = "";

  for (const item of status.activity || []) {
    const row = document.createElement("div");
    const when = item.time
      ? new Date(item.time).toLocaleString()
      : "";
    row.textContent = `${when} – ${item.message}`;
    activity.appendChild(row);
  }
}

async function runCommand(button, command, successText) {
  button.disabled = true;
  showMessage("Bitte warten …");

  try {
    const result = await callThunderCat(command);

    showMessage(
      typeof successText === "function"
        ? successText(result)
        : successText
    );

    await refresh();
  } catch (error) {
    showMessage(error.message || String(error), true);
  } finally {
    button.disabled = false;
  }
}

$("#scan").addEventListener("click", event => {
  runCommand(
    event.currentTarget,
    "scanInbox",
    result =>
      `${result.processed} Nachrichten in ${result.scannedFolders || 0} Ordner(n) geprüft, ` +
      `${result.moved} verschoben.`
  );
});

$("#folders").addEventListener("click", event => {
  runCommand(
    event.currentTarget,
    "ensureBaseFolders",
    result =>
      `${result.inboxes} Posteingang/Posteingänge geprüft.`
  );
});

$("#settings").addEventListener("click", () => {
  messenger.runtime.openOptionsPage();
});

refresh().catch(error => {
  showMessage(error.message || String(error), true);
});
