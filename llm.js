// Provider registry, settings and the cross-provider fallback chain.
import { LlmError } from "./providers/core.js";
import * as gemini from "./providers/gemini.js";
import * as anthropic from "./providers/anthropic.js";
import { adapter } from "./providers/openai-compat.js";
import { VaultError, getFileSettings, readVaultKeys, touchAutoLock } from "./vault.js";

export { LlmError, getFileSettings };

// Model lists are suggestions for the settings page; any model ID the provider accepts works.
export const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    limitUrl: "https://console.cloud.google.com/billing/budgets",
    models: ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-pro-latest"],
    ask: gemini.ask,
  },
  openai: {
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    limitUrl: "https://platform.openai.com/settings/organization/limits",
    models: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"],
    ask: adapter("openai"),
  },
  anthropic: {
    label: "Anthropic (Claude)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    limitUrl: "https://console.anthropic.com/settings/limits",
    models: ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"],
    ask: anthropic.ask,
  },
  openrouter: {
    label: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    limitUrl: "https://openrouter.ai/settings/keys",
    models: ["google/gemini-3.5-flash", "anthropic/claude-sonnet-5", "openai/gpt-6-luna", "deepseek/deepseek-v4-pro"],
    ask: adapter("openrouter"),
  },
  deepseek: {
    label: "DeepSeek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    limitUrl: "https://platform.deepseek.com/usage",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    ask: adapter("deepseek"),
  },
};

export const KEY_PROVIDERS = Object.keys(PROVIDERS).filter((p) => !PROVIDERS[p].account);
export const ACCOUNT_PROVIDERS = Object.keys(PROVIDERS).filter((p) => PROVIDERS[p].account);

export const DEFAULT_SETTINGS = {
  keys: Object.fromEntries(KEY_PROVIDERS.map((p) => [p, ""])),
  chain: [
    { provider: "gemini", model: "gemini-flash-latest" },
    { provider: "gemini", model: "gemini-flash-lite-latest" },
  ],
  language: "auto",
};

const filled = (v) => typeof v === "string" && v.trim() !== "";

// Accepts the current shape or the old Gemini-only one ({ apiKey, model, fallbackModels }).
// Returns only the parts that are actually set.
export function normalizeSettings(src = {}) {
  const out = { keys: {} };
  for (const p of KEY_PROVIDERS) {
    if (filled(src.keys?.[p])) out.keys[p] = src.keys[p].trim();
  }
  if (!out.keys.gemini && filled(src.apiKey)) out.keys.gemini = src.apiKey.trim();

  if (Array.isArray(src.chain)) {
    const chain = src.chain
      .filter((e) => e && PROVIDERS[e.provider] && filled(e.model))
      .map((e) => ({ provider: e.provider, model: e.model.trim() }));
    if (chain.length) out.chain = chain;
  } else if (filled(src.model) || filled(src.fallbackModels)) {
    const models = [src.model, ...String(src.fallbackModels || "").split(",")].filter(filled).map((m) => m.trim());
    out.chain = [...new Set(models)].map((model) => ({ provider: "gemini", model }));
  }

  if (filled(src.language)) out.language = src.language.trim();
  return out;
}

// Priority: settings page > config.json > defaults; keys merge per provider, and keys from the
// encrypted vault win over unencrypted ones. Adds: vault (a vault exists), locked (it isn't
// unlocked, so its keys are missing), plainKeysInFile (config.json holds unencrypted keys).
export async function getSettings() {
  const [file, stored] = await Promise.all([getFileSettings(), chrome.storage.local.get(null)]);
  const settings = { ...structuredClone(DEFAULT_SETTINGS), vault: false, locked: false };
  for (const source of [file, stored]) {
    const n = normalizeSettings(source);
    Object.assign(settings.keys, n.keys);
    if (n.chain) settings.chain = n.chain;
    if (n.language) settings.language = n.language;
  }
  settings.plainKeysInFile = Object.keys(normalizeSettings(file).keys).length > 0;
  try {
    const vaultKeys = await readVaultKeys();
    if (vaultKeys) {
      settings.vault = true;
      Object.assign(settings.keys, normalizeSettings({ keys: vaultKeys }).keys);
    }
  } catch (e) {
    if (!(e instanceof VaultError)) throw e;
    settings.vault = true;
    settings.locked = true;
  }
  return settings;
}

export const entryId = (entry) => `${entry.provider}/${entry.model}`;

// input is the question text or { image: { mimeType, data } }.
// Asks each chain entry in turn until one answers; onRetry(entryId) is called before every fallback.
export async function askChain(input, settings, onRetry = () => {}) {
  const chain = (settings.chain || []).filter((e) => PROVIDERS[e.provider] && filled(e.model));
  if (!chain.length) throw new LlmError("No models in the chain.", { needsSettings: true });

  const failures = [];
  let needsSettings = false;
  for (const entry of chain) {
    const id = entryId(entry);
    const provider = PROVIDERS[entry.provider];
    const apiKey = settings.keys?.[entry.provider];
    if (!provider.account && !apiKey) {
      failures.push(`${id}: ${settings.locked ? "API keys are locked (open settings to unlock)" : "no API key"}`);
      needsSettings = true;
      continue;
    }
    if (failures.length) onRetry(id);
    if (!provider.account && settings.vault) touchAutoLock().catch(() => {});
    try {
      const data = await provider.ask({ input, model: entry.model, apiKey, language: settings.language });
      return { ...data, model: id };
    } catch (e) {
      failures.push(`${id}: ${e.message}`);
      if (e.needsSettings) needsSettings = true;
      console.warn(`[Ask AI] ${id} failed:`, e.message);
    }
  }
  throw new LlmError(failures.length === 1 ? failures[0] : `All models failed:\n${failures.join("\n")}`, {
    needsSettings,
  });
}
