// Encrypted storage for API keys, protected by a master password the user chooses.
//
// With a password, on disk (chrome.storage.local / config.json) there is only
//   vault: { v, salt, iterations, iv, ciphertext }   (AES-256-GCM, key from PBKDF2-SHA256)
// While unlocked, the derived key lives only in chrome.storage.session (memory, cleared when
// Brave quits, not readable by content scripts). Plaintext keys are never written to disk.
//
// The password is optional: without one there is no vault and the keys sit unencrypted in
// chrome.storage.local ("keys"). `vault: false` there means the user removed the password,
// so a vault in config.json must not come back.

const ITERATIONS = 600000;
const SESSION_KEY = "vaultKey";
const AUTOLOCK_ALARM = "vault-autolock";

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class VaultError extends Error {}

// ---------- pure crypto (no chrome APIs; unit-testable) ----------

async function deriveRaw(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, 256);
  return new Uint8Array(bits);
}

const aesKey = (raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

async function encryptKeys(keys, raw, salt, iterations) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // fresh IV for every save
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(raw), enc.encode(JSON.stringify(keys)));
  return { v: 1, salt: toB64(salt), iterations, iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

export async function decryptVault(vault, raw) {
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(vault.iv) }, await aesKey(raw), fromB64(vault.ciphertext));
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new VaultError("Wrong password.");
  }
}

export async function sealKeys(keys, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const raw = await deriveRaw(password, salt, ITERATIONS);
  return { vault: await encryptKeys(keys, raw, salt, ITERATIONS), raw };
}

export async function resealKeys(keys, raw, vault) {
  return encryptKeys(keys, raw, fromB64(vault.salt), vault.iterations);
}

export async function openVault(vault, password) {
  if (!vault || vault.v !== 1) throw new VaultError("Unknown vault format.");
  const raw = await deriveRaw(password, fromB64(vault.salt), vault.iterations);
  return { keys: await decryptVault(vault, raw), raw };
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) return "Use at least 8 characters.";
  return null;
}

// ---------- storage ----------

// Optional config.json in the extension folder. Unlike chrome.storage it survives
// removing and re-adding the extension.
export async function getFileSettings() {
  try {
    const res = await fetch(chrome.runtime.getURL("config.json"));
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

// The vault in chrome.storage wins; config.json's vault is used when there is none.
export async function findVault() {
  const { vault } = await chrome.storage.local.get("vault");
  if (vault !== undefined) return vault || null;
  const file = await getFileSettings();
  return file.vault || null;
}

async function getSessionRaw() {
  const { [SESSION_KEY]: b64 } = await chrome.storage.session.get(SESSION_KEY);
  return b64 ? fromB64(b64) : null;
}

async function setSessionRaw(raw) {
  await chrome.storage.session.set({ [SESSION_KEY]: toB64(raw) });
  await touchAutoLock();
}

// Returns the decrypted keys, or null when there is no vault. Throws VaultError("locked") when locked.
export async function readVaultKeys() {
  const vault = await findVault();
  if (!vault) return null;
  const raw = await getSessionRaw();
  if (!raw) throw new VaultError("locked");
  try {
    return await decryptVault(vault, raw);
  } catch {
    // The vault changed (e.g. password changed elsewhere): treat as locked.
    await lockVault();
    throw new VaultError("locked");
  }
}

export async function isLocked() {
  const vault = await findVault();
  return Boolean(vault) && !(await getSessionRaw());
}

export async function unlockVault(password) {
  const vault = await findVault();
  if (!vault) throw new VaultError("No vault to unlock.");
  const { keys, raw } = await openVault(vault, password);
  await setSessionRaw(raw);
  return keys;
}

export async function lockVault() {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms?.clear(AUTOLOCK_ALARM);
}

export async function createVault(password, keys) {
  const problem = validatePassword(password);
  if (problem) throw new VaultError(problem);
  const { vault, raw } = await sealKeys(keys, password);
  await chrome.storage.local.set({ vault });
  await chrome.storage.local.remove(["keys", "apiKey"]); // drop the unencrypted copies
  await setSessionRaw(raw);
}

export async function saveVaultKeys(keys) {
  const vault = await findVault();
  const raw = await getSessionRaw();
  if (!vault || !raw) throw new VaultError("locked");
  await chrome.storage.local.set({ vault: await resealKeys(keys, raw, vault) });
  await chrome.storage.local.remove(["keys", "apiKey"]);
}

export async function changePassword(oldPassword, newPassword) {
  const problem = validatePassword(newPassword);
  if (problem) throw new VaultError(problem);
  const { keys } = await openVault(await findVault(), oldPassword);
  const { vault, raw } = await sealKeys(keys, newPassword);
  await chrome.storage.local.set({ vault });
  await setSessionRaw(raw);
}

// Back to no password: the keys are stored unencrypted from here on.
export async function removePassword(password) {
  const { keys } = await openVault(await findVault(), password);
  await chrome.storage.local.set({ keys, vault: false });
  await lockVault();
}

export async function resetVault() {
  await chrome.storage.local.remove(["vault", "keys", "apiKey"]);
  await lockVault();
}

// ---------- auto-lock ----------

// (Re)starts the idle timer; called on unlock and whenever keys are used.
export async function touchAutoLock() {
  if (!chrome.alarms) return;
  const { autoLockMinutes } = await chrome.storage.local.get("autoLockMinutes");
  if (autoLockMinutes > 0) await chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: autoLockMinutes });
  else await chrome.alarms.clear(AUTOLOCK_ALARM);
}

export function handleAlarm(alarm) {
  if (alarm.name === AUTOLOCK_ALARM) return lockVault();
}
