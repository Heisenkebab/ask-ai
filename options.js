import { askGemini, getFileSettings, getSettings } from "./gemini.js";

const $ = (id) => document.getElementById(id);
const fields = ["apiKey", "model", "fallbackModels", "language"];

function readForm() {
  return Object.fromEntries(fields.map((f) => [f, $(f).value.trim()]));
}

function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = cls;
}

async function load() {
  const [settings, file] = await Promise.all([getSettings(), getFileSettings()]);
  for (const f of fields) $(f).value = settings[f];
  if (file.apiKey) $("fileNote").hidden = false;
}

// Save on every change so nothing is lost by forgetting a button.
let saveTimer;
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set(readForm());
    setStatus("Saved ✓", "ok");
  }, 300);
}

for (const f of fields) {
  $(f).addEventListener("input", autoSave);
  $(f).addEventListener("change", autoSave);
}

$("test").addEventListener("click", async () => {
  setStatus("Testing…");
  try {
    const data = await askGemini("What is 2 + 2? A) 3 B) 4 C) 5", readForm());
    const got = data.correct_options.map((o) => o.label).join(", ") || data.answer;
    setStatus(`Works ✓ (${data.model} answered: ${got})`, "ok");
  } catch (e) {
    setStatus(e.message, "err");
  }
});

$("download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(readForm(), null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

load();
