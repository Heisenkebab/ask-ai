import { PROVIDERS, askChain, getFileSettings, getSettings, normalizeSettings } from "./llm.js";

const $ = (id) => document.getElementById(id);
const TEST_QUESTION = "What is 2 + 2? A) 3 B) 4 C) 5";
const OLD_FIELDS = ["apiKey", "model", "fallbackModels"];

let state; // { keys, chain, language }

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function setStatus(node, text, cls = "") {
  node.textContent = text;
  node.className = `${node.className.split(" ")[0]} ${cls}`.trim();
}

const describe = (data) => data.correct_options.map((o) => o.label).join(", ") || data.answer;

// ---------- saving ----------

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ keys: state.keys, chain: state.chain, language: state.language });
    await chrome.storage.local.remove(OLD_FIELDS); // migrated into keys/chain
    setStatus($("status"), "Saved ✓", "ok");
  }, 300);
}

// ---------- API keys ----------

function renderKeys() {
  const container = $("keys");
  container.replaceChildren();
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const input = el("input", { type: "password", autocomplete: "off", spellcheck: false, value: state.keys[id] || "", placeholder: "API key" });
    const status = el("div", { className: "key-status" });
    input.addEventListener("input", () => {
      state.keys[id] = input.value.trim();
      renderChain();
      save();
    });
    const test = el("button", { textContent: "Test" });
    test.addEventListener("click", async () => {
      const model = state.chain.find((e) => e.provider === id && e.model)?.model || p.models[0];
      setStatus(status, `Testing ${model}…`);
      try {
        const data = await askChain(TEST_QUESTION, { ...state, chain: [{ provider: id, model }] });
        setStatus(status, `Works ✓ (${data.model} answered: ${describe(data)})`, "ok");
      } catch (e) {
        setStatus(status, e.message, "err");
      }
    });
    const label = el("label", { textContent: p.label }, el("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: "Get a key" }));
    container.append(el("div", { className: "key-row" }, label, input, test, status));
  }
}

// ---------- model chain ----------

function renderDatalists() {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    document.body.append(el("datalist", { id: `models-${id}` }, ...p.models.map((m) => el("option", { value: m }))));
  }
}

function renderChain() {
  const container = $("chain");
  container.replaceChildren();
  state.chain.forEach((entry, i) => {
    const select = el(
      "select",
      {},
      ...Object.entries(PROVIDERS).map(([id, p]) => el("option", { value: id, textContent: p.label, selected: id === entry.provider })),
    );
    select.addEventListener("change", () => {
      entry.provider = select.value;
      entry.model = PROVIDERS[entry.provider].models[0];
      renderChain();
      save();
    });

    const model = el("input", { type: "text", spellcheck: false, value: entry.model, placeholder: "model ID" });
    model.setAttribute("list", `models-${entry.provider}`);
    model.addEventListener("input", () => {
      entry.model = model.value.trim();
      save();
    });

    const move = (delta) => {
      const [item] = state.chain.splice(i, 1);
      state.chain.splice(i + delta, 0, item);
      renderChain();
      save();
    };
    const up = el("button", { className: "icon", textContent: "↑", title: "Move up", disabled: i === 0 });
    up.addEventListener("click", () => move(-1));
    const down = el("button", { className: "icon", textContent: "↓", title: "Move down", disabled: i === state.chain.length - 1 });
    down.addEventListener("click", () => move(1));
    const remove = el("button", { className: "icon", textContent: "✕", title: "Remove", disabled: state.chain.length === 1 });
    remove.addEventListener("click", () => {
      state.chain.splice(i, 1);
      renderChain();
      save();
    });

    const hasKey = Boolean(state.keys[entry.provider]);
    const row = el("div", { className: `chain-row${hasKey ? "" : " nokey"}` }, el("span", { className: "num", textContent: `${i + 1}.` }), select, model, up, down, remove);
    container.append(row);
    if (!hasKey) container.append(el("div", { className: "chain-row" }, el("div", { className: "nokey-note", textContent: `No ${PROVIDERS[entry.provider].label} key: this entry is skipped.` })));
  });
}

$("addModel").addEventListener("click", () => {
  // Default to the first provider that has a key, so the new row is usable right away.
  const provider = Object.keys(PROVIDERS).find((p) => state.keys[p]) || "gemini";
  state.chain.push({ provider, model: PROVIDERS[provider].models[0] });
  renderChain();
  save();
});

// ---------- other controls ----------

$("language").addEventListener("change", () => {
  state.language = $("language").value;
  save();
});

$("testChain").addEventListener("click", async () => {
  setStatus($("status"), "Testing chain…");
  try {
    const data = await askChain(TEST_QUESTION, state, (next) => setStatus($("status"), `Trying ${next}…`));
    setStatus($("status"), `Works ✓ (${data.model} answered: ${describe(data)})`, "ok");
  } catch (e) {
    setStatus($("status"), e.message, "err");
  }
});

$("download").addEventListener("click", () => {
  const config = { keys: state.keys, chain: state.chain.filter((e) => e.model), language: state.language };
  const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "config.json" });
  a.click();
  URL.revokeObjectURL(a.href);
});

async function load() {
  const [settings, file] = await Promise.all([getSettings(), getFileSettings()]);
  state = settings;
  $("language").value = state.language;
  const fileKeys = Object.keys(normalizeSettings(file).keys);
  if (fileKeys.length) {
    $("fileNote").textContent = `✓ Keys found in config.json: ${fileKeys.map((p) => PROVIDERS[p].label).join(", ")}.`;
    $("fileNote").hidden = false;
  }
  renderDatalists();
  renderKeys();
  renderChain();
}

load();
