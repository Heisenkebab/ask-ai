import { PROVIDERS, askChain, getSettings, LlmError } from "./llm.js";
import { questionWithContext } from "./providers/core.js";
import { collectContext } from "./plugins.js";
import { handleAlarm } from "./vault.js";

const MENU_ID = "ask-ai-selection";
const MAX_CHARS = 20000;
const DEFAULT_TITLE = chrome.runtime.getManifest().action.default_title;

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Ask AI about selection",
    contexts: ["selection"],
  });
  if (details.reason === "install") {
    const { keys } = await getSettings();
    if (!Object.values(keys).some(Boolean)) chrome.runtime.openOptionsPage();
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "ask-gemini") handleAsk(tab);
  if (command === "toggle-popup") togglePopup(tab);
  if (command === "ask-screenshot") handleScreenshot(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) handleAsk(tab, info.selectionText);
});

chrome.action.onClicked.addListener((tab) => handleAsk(tab));

// Auto-lock timer for the key vault.
chrome.alarms.onAlarm.addListener(handleAlarm);

// While the vault is locked (and the chain needs API keys), the toolbar icon opens the unlock
// window instead of asking. Passwords are only ever typed into extension pages, never web pages.
async function refreshToolbar() {
  const settings = await getSettings();
  const needsKeys = settings.chain.some((e) => PROVIDERS[e.provider] && !PROVIDERS[e.provider].account);
  const locked = settings.locked && needsKeys;
  await chrome.action.setPopup({ popup: locked ? "unlock.html" : "" });
  await chrome.action.setBadgeText({ text: locked ? "🔒" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#5f6368" });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" || "vault" in changes || "chain" in changes) refreshToolbar();
});
chrome.runtime.onStartup.addListener(refreshToolbar);
refreshToolbar();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "openOptions") chrome.runtime.openOptionsPage();
});

// Runs in every frame of the page: returns the selected text and where it is.
function readSelection() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : "";
  let rect = null;
  if (text && sel.rangeCount) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    rect = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }
  return { text, rect };
}

async function handleAsk(tab, fallbackText = "") {
  if (!tab?.id) return;
  const tabId = tab.id;

  let selection;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: readSelection,
    });
    const hit = results.find((r) => r.result?.text);
    selection = {
      text: hit?.result.text || fallbackText.trim(),
      // Only the top frame gets the popup; iframe coordinates don't map onto it.
      rect: hit?.frameId === 0 ? hit.result.rect : null,
    };
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content.js"],
    });
  } catch (e) {
    // Restricted pages (brave://, Web Store, PDF viewer) can't be scripted.
    flagBadge(tabId, `Can't run on this page: ${e.message}`);
    return;
  }

  if (!selection.text) {
    popupSender(tabId, selection.rect)({ state: "error", message: "Select some text first, then press the hotkey." });
    return;
  }
  const send = popupSender(tabId, selection.rect);
  send({ state: "loading" });
  await runQuery(send, async (settings) => {
    // Plugins read the page while the selection is still there; then the highlight is removed.
    const context = await collectContext(tabId, { selectionText: selection.text, rect: null }, settings.plugins);
    chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, func: () => window.getSelection()?.removeAllRanges() })
      .catch(() => {});
    return questionWithContext(selection.text.slice(0, MAX_CHARS - context.length - 20), context);
  });
}

function popupSender(tabId, rect) {
  const requestId = crypto.randomUUID();
  return (payload) =>
    chrome.tabs.sendMessage(tabId, { requestId, rect, ...payload }, { frameId: 0 }).catch(() => {});
}

// prepare(settings) builds the input (question text or { image, context? }); then the model chain
// runs and the answer (or error) is shown in the popup.
async function runQuery(send, prepare) {
  try {
    const settings = await getSettings();
    const input = await prepare(settings);
    // Service worker console (brave://extensions → Inspect views). Never log keys here.
    const started = Date.now();
    console.log(`[Ask AI] asking: ${typeof input === "string" ? `${input.length} characters` : `screenshot${input.context ? ` + ${input.context.length} characters of page context` : ""}`}`);
    const data = await askChain(input, settings, (next) =>
      send({ state: "loading", message: `Trying ${next}…` }),
    );
    console.log(`[Ask AI] answered by ${data.model} in ${((Date.now() - started) / 1000).toFixed(1)}s`, data);
    send({ state: "answer", data });
  } catch (e) {
    send({
      state: "error",
      message: e.message,
      needsSettings: e instanceof LlmError && e.needsSettings,
    });
  }
}

// Hotkey → user drags a box on the page → that part of the visible tab goes to the model as an image.
async function handleScreenshot(tab) {
  if (!tab?.id) return;
  const tabId = tab.id;

  let region;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => window.__askGeminiSelectRegion(),
    });
    region = result;
  } catch (e) {
    flagBadge(tabId, `Can't run on this page: ${e.message}`);
    return;
  }
  if (!region) return; // cancelled with Esc or a click without dragging

  const send = popupSender(tabId, region.rect);
  await runQuery(send, async (settings) => {
    // Before the capture and the loading popup, so neither shows up in the screenshot.
    const context = await collectContext(tabId, { selectionText: "", rect: region.rect }, settings.plugins);
    let image;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      image = await cropToBase64(dataUrl, region);
    } catch (e) {
      throw new LlmError(`Screenshot failed: ${e.message}`);
    }
    send({ state: "loading" });
    return context ? { image, context } : { image };
  });
}

async function cropToBase64(dataUrl, { rect, viewportWidth }) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // The capture is in device pixels; the rect is in CSS pixels.
  const scale = bitmap.width / viewportWidth;
  const sx = Math.max(0, Math.round(rect.left * scale));
  const sy = Math.max(0, Math.round(rect.top * scale));
  const sw = Math.min(bitmap.width - sx, Math.round((rect.right - rect.left) * scale));
  const sh = Math.min(bitmap.height - sy, Math.round((rect.bottom - rect.top) * scale));
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: "image/png", data: btoa(binary) };
}

async function togglePopup(tab) {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: () => window.__askGeminiToggle?.(),
    });
  } catch {
    // No popup can exist on pages we can't script.
  }
}

function flagBadge(tabId, title) {
  chrome.action.setBadgeText({ tabId, text: "!" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#d93025" });
  chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }, 4000);
}
