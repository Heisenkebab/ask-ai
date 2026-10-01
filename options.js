import { ACCOUNT_PROVIDERS, KEY_PROVIDERS, PROVIDERS, askChain, getSettings } from "./llm.js";
import { changePassword, createVault, findVault, lockVault, removePassword, resetVault, saveVaultKeys, unlockVault } from "./vault.js";

const $ = (id) => document.getElementById(id);
const TEST_QUESTION = "What is 2 + 2? A) 3 B) 4 C) 5";
const OLD_FIELDS = ["apiKey", "model", "fallbackModels"];

let state; // getSettings(): { keys, chain, language, vault, locked, plainKeysInFile } + noPassword

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
const hasKeys = () => KEY_PROVIDERS.some((p) => state.keys[p]);

async function testEntry(provider, statusNode) {
  const model = state.chain.find((e) => e.provider === provider && e.model)?.model || PROVIDERS[provider].models[0];
  setStatus(statusNode, `Testing ${model}…`);
  try {
    const data = await askChain(TEST_QUESTION, { ...state, chain: [{ provider, model }] });
    setStatus(statusNode, `Works ✓ (${data.model} answered: ${describe(data)})`, "ok");
  } catch (e) {
    setStatus(statusNode, e.message, "err");
  }
}

// ---------- saving (chain + language; keys go into the vault, or stay plain without a password) ----------

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ chain: state.chain, language: state.language });
    await chrome.storage.local.remove(OLD_FIELDS); // migrated into chain / vault
    setStatus($("status"), "Saved ✓", "ok");
  }, 300);
}

let keyTimer;
function saveKeys() {
  clearTimeout(keyTimer);
  keyTimer = setTimeout(async () => {
    try {
      if (state.vault) await saveVaultKeys(state.keys);
      else await chrome.storage.local.set({ keys: state.keys });
      setStatus($("status"), state.vault ? "Keys saved (encrypted) ✓" : "Keys saved (not encrypted) ✓", "ok");
    } catch (e) {
      setStatus($("status"), e.message === "locked" ? "Locked – unlock to save keys." : e.message, "err");
    }
  }, 400);
}

// ---------- API keys (vault) ----------

function passwordInput(placeholder, autocomplete = "new-password") {
  return el("input", { type: "password", placeholder, autocomplete });
}

function renderKeyRows(box) {
  for (const id of KEY_PROVIDERS) {
    const p = PROVIDERS[id];
    const input = el("input", { type: "password", autocomplete: "off", spellcheck: false, value: state.keys[id] || "", placeholder: "API key" });
    const statusNode = el("div", { className: "key-status" });
    input.addEventListener("input", () => {
      state.keys[id] = input.value.trim();
      renderChain();
      saveKeys();
    });
    const test = el("button", { textContent: "Test" });
    test.addEventListener("click", () => testEntry(id, statusNode));
    const label = el(
      "label",
      { textContent: p.label },
      el("a", { href: p.keyUrl, target: "_blank", rel: "noopener", textContent: "Get a key" }),
      el("a", { href: p.limitUrl, target: "_blank", rel: "noopener", textContent: "Set a spending limit" }),
    );
    box.append(el("div", { className: "key-row" }, label, input, test, statusNode));
  }
}

function renderVault() {
  const box = $("vaultBox");
  box.replaceChildren();
  const message = el("div", { className: "key-status" });

  if (!state.vault) {
    // No password: keys are usable right away, stored unencrypted. Setting one encrypts them.
    const pw1 = passwordInput("Master password (min. 8 characters)");
    const pw2 = passwordInput("Repeat password");
    const button = el("button", { className: "primary", textContent: hasKeys() ? "Encrypt my keys" : "Set password" });
    button.addEventListener("click", async () => {
      if (pw1.value !== pw2.value) return setStatus(message, "Passwords don't match.", "err");
      try {
        setStatus(message, "Encrypting…");
        clearTimeout(keyTimer); // a pending plain save must not land after the vault is created
        await createVault(pw1.value, state.keys);
        await reload();
      } catch (e) {
        setStatus(message, e.message, "err");
      }
    });
    if (!state.noPassword) {
      // Default: ask for a password first; going without one is an explicit choice.
      const skip = el("button", { className: "link", textContent: "Use without a password (faster, less secure)" });
      skip.addEventListener("click", async () => {
        if (!confirm("Continue without a master password? Your API keys will be stored unencrypted on this computer.")) return;
        await chrome.storage.local.set({ vault: false });
        await reload();
      });
      box.append(
        el("p", {
          className: "hint",
          textContent: hasKeys()
            ? "Your API keys are currently stored unencrypted. Set a master password to encrypt them. You'll enter it once per Brave start."
            : "Set a master password first. Keys are stored encrypted with it; you'll enter it once per Brave start.",
        }),
        el("div", { className: "pw-row" }, pw1, pw2, button),
        message,
        skip,
      );
      return;
    }
    box.append(
      el("p", {
        className: "hint",
        textContent:
          "🔓 No master password: keys work without unlocking, but are stored unencrypted on this computer. Anyone (or any program) with access to your Brave profile can read them.",
      }),
    );
    renderKeyRows(box);
    box.append(
      el(
        "details",
        {},
        el("summary", { textContent: "Set a master password (optional, more secure)" }),
        el("p", { className: "hint", textContent: "Encrypts your keys. You'll enter the password once per Brave start." }),
        el("div", { className: "pw-row" }, pw1, pw2, button),
      ),
      message,
    );
    return;
  }

  if (state.locked) {
    const pw = passwordInput("Master password", "current-password");
    const unlock = el("button", { className: "primary", textContent: "Unlock" });
    const doUnlock = async () => {
      try {
        setStatus(message, "Unlocking…");
        await unlockVault(pw.value);
        await reload();
      } catch (e) {
        setStatus(message, e.message, "err");
      }
    };
    unlock.addEventListener("click", doUnlock);
    pw.addEventListener("keydown", (e) => e.key === "Enter" && doUnlock());
    const reset = el("button", { className: "link", textContent: "Forgot password? Reset" });
    reset.addEventListener("click", async () => {
      if (!confirm("Delete the encrypted keys? You'll have to enter your API keys again.")) return;
      await resetVault();
      await reload();
    });
    box.append(el("p", { className: "hint", textContent: "🔒 Keys are locked." }), el("div", { className: "pw-row" }, pw, unlock), message, reset);
    return;
  }

  // Unlocked: editable keys.
  renderKeyRows(box);

  const lock = el("button", { textContent: "🔒 Lock now" });
  lock.addEventListener("click", async () => {
    await lockVault();
    await reload();
  });
  const autoLock = el(
    "select",
    { title: "Auto-lock" },
    ...[0, 5, 15, 30, 60].map((m) => el("option", { value: m, textContent: m ? `Lock after ${m} min unused` : "Lock only when Brave quits" })),
  );
  chrome.storage.local.get("autoLockMinutes").then(({ autoLockMinutes = 0 }) => (autoLock.value = autoLockMinutes));
  autoLock.addEventListener("change", () => chrome.storage.local.set({ autoLockMinutes: Number(autoLock.value) }));

  const oldPw = passwordInput("Current password", "current-password");
  const newPw1 = passwordInput("New password");
  const newPw2 = passwordInput("Repeat new password");
  const change = el("button", { textContent: "Change password" });
  change.addEventListener("click", async () => {
    if (newPw1.value !== newPw2.value) return setStatus(message, "New passwords don't match.", "err");
    try {
      setStatus(message, "Changing…");
      await changePassword(oldPw.value, newPw1.value);
      setStatus(message, "Password changed ✓", "ok");
      oldPw.value = newPw1.value = newPw2.value = "";
    } catch (e) {
      setStatus(message, e.message, "err");
    }
  });
  const details = el("details", {}, el("summary", { textContent: "Change password" }), el("div", { className: "pw-row" }, oldPw, newPw1, newPw2, change));

  const removePw = passwordInput("Current password", "current-password");
  const remove = el("button", { textContent: "Remove password" });
  remove.addEventListener("click", async () => {
    if (!confirm("Remove the master password? Your API keys will be stored unencrypted on this computer.")) return;
    try {
      setStatus(message, "Removing…");
      clearTimeout(keyTimer);
      await removePassword(removePw.value);
      await reload();
    } catch (e) {
      setStatus(message, e.message, "err");
    }
  });
  const removeDetails = el(
    "details",
    {},
    el("summary", { textContent: "Remove password (faster, less secure)" }),
    el("p", { className: "hint", textContent: "No more unlocking, but your keys are stored unencrypted." }),
    el("div", { className: "pw-row" }, removePw, remove),
  );
  box.append(el("div", { className: "row" }, lock, autoLock), details, removeDetails, message);
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
      el("optgroup", { label: "Accounts (no key)" }, ...ACCOUNT_PROVIDERS.map((id) => el("option", { value: id, textContent: PROVIDERS[id].label, selected: id === entry.provider }))),
      el("optgroup", { label: "API keys" }, ...KEY_PROVIDERS.map((id) => el("option", { value: id, textContent: PROVIDERS[id].label, selected: id === entry.provider }))),
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

    const usable = PROVIDERS[entry.provider].account || Boolean(state.keys[entry.provider]);
    container.append(el("div", { className: `chain-row${usable ? "" : " nokey"}` }, el("span", { className: "num", textContent: `${i + 1}.` }), select, model, up, down, remove));
    if (!usable) {
      const why = state.locked ? "keys are locked" : `no ${PROVIDERS[entry.provider].label} key`;
      container.append(el("div", { className: "chain-row" }, el("div", { className: "nokey-note", textContent: `Skipped: ${why}.` })));
    }
  });
}

$("addModel").addEventListener("click", () => {
  const provider = KEY_PROVIDERS.find((p) => state.keys[p]) || KEY_PROVIDERS[0];
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

// Exports only the encrypted vault, never plain keys.
$("download").addEventListener("click", async () => {
  const vault = await findVault();
  const config = { ...(vault ? { vault } : {}), chain: state.chain.filter((e) => e.model), language: state.language };
  const blob = new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "config.json" });
  a.click();
  URL.revokeObjectURL(a.href);
  if (!vault && hasKeys()) setStatus($("status"), "Exported without keys – set a master password to include them (encrypted).", "err");
});

async function reload() {
  state = await getSettings();
  // vault: false = the user chose to go without a password.
  state.noPassword = (await chrome.storage.local.get("vault")).vault === false;
  $("language").value = state.language;
  $("fileWarning").hidden = !(state.plainKeysInFile && state.vault);
  renderVault();
  renderChain();
}

chrome.storage.onChanged.addListener((changes, area) => {
  // Locked/unlocked from the toolbar or by auto-lock.
  if (area === "session") reload();
});

renderDatalists();
await reload();
