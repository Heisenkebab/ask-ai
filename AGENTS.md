# AGENTS.md

Guidance for AI coding agents working on this repo. User-facing docs are in `README.md`.

## What this is

**Ask AI**: a Manifest V3 extension for Brave/Chrome. The user highlights a question (or drags a box for a screenshot), presses a hotkey, and the answer appears in a small transparent popup on the page. Answers come from a fallback chain of models: API-key providers (Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek) and "account" providers that run the user's logged-in CLI (`claude`, `agy`, `codex`) through a native messaging helper.

## Hard constraints

- **Plain JavaScript, no build step, no dependencies, no package.json.** ES modules loaded directly by the browser. Don't add npm packages, bundlers, TypeScript or provider SDKs; all API calls are raw `fetch`.
- **The helper (`native-host/ask-ai-host.mjs`) is Node with the standard library only.**
- Match the existing style: 2-space indent, double quotes, semicolons, small functions, comments only where the *why* isn't obvious.
- Don't commit or push unless asked. `config.json` (may hold keys / the encrypted vault) is git-ignored; never commit it.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Permissions, hotkeys (`commands`), fixed `"key"` (stable extension ID) |
| `background.js` | Service worker: hotkeys, context menu, reads the selection, screenshot capture + crop, runs the chain, toolbar lock state |
| `content.js` | Injected on demand (never declared in the manifest). Answer popup in a **closed** Shadow DOM, screenshot region picker, hide/show toggle |
| `llm.js` | `PROVIDERS` registry, `getSettings()` (defaults < `config.json` < `chrome.storage`, plus old-format migration), `askChain()` |
| `providers/core.js` | Shared: `systemPrompt()`, `ANSWER_SCHEMA`, `postJson()`, HTTP status → `LlmError`, `parseAnswer()`, `withFormatFallback()` |
| `providers/gemini.js`, `openai-compat.js`, `anthropic.js` | API adapters. `openai-compat.js` serves OpenAI, OpenRouter and DeepSeek |
| `providers/account.js` | Account adapters: `chrome.runtime.sendNativeMessage("com.askai.bridge", …)` |
| `vault.js` | Master-password encryption of API keys (PBKDF2-SHA256 600k → AES-256-GCM), lock/unlock, auto-lock |
| `options.html/js` | Settings page: accounts status, vault, model chain. Auto-saves |
| `unlock.html/js` | Toolbar popup shown while keys are locked |
| `native-host/` | `ask-ai-host.mjs` (helper), `install.sh` / `uninstall.sh`, `extension-id.mjs` |
| `test/questions.html` | Manual test page |

## How a question flows

1. Hotkey / context menu / toolbar → `background.js` (`handleAsk` or `handleScreenshot`).
2. Selection text via `chrome.scripting.executeScript` (all frames); screenshot via `captureVisibleTab` + `cropToBase64`.
3. `content.js` is injected into the top frame; background sends `{requestId, state: "loading" | "answer" | "error", rect, …}` messages.
4. `askChain(input, settings, onRetry)` walks `settings.chain`; `input` is a string or `{ image: { mimeType, data } }`. Every adapter is `ask({ input, model, apiKey, language })` → `{ type, correct_options, answer }`.
5. **Any** adapter failure moves on to the next chain entry; if all fail, one `LlmError` lists every reason. `needsSettings` makes the popup show "Open settings".

To add an API provider: add an entry to `PROVIDERS` in `llm.js`, an adapter (or a config in `openai-compat.js`), and its host to `host_permissions`.

## Security rules (do not weaken)

- **Web pages are untrusted.** Selected text and screenshots can contain prompt injections.
- **Account CLIs must run with all tools disabled.** Claude: `--tools "" --strict-mcp-config --safe-mode --permission-mode dontAsk --disable-slash-commands --no-session-persistence` (never `--bare`: it skips the account login). Antigravity (`agy`, replaced the deprecated Gemini CLI): it has no "no tools" flag, so the helper writes `.agents/hooks.json` with a `PreToolUse` hook (matcher `*`) that denies every tool call except `finish` (how agy returns the `--json-schema` answer; denying it makes the model retry for ~50 s), and passes the temp dir with `--add-dir` (without it the hook isn't loaded; check for free with `agy --add-dir <dir> -p "/hooks"`), plus `--sandbox --disable-slash-commands`. Codex: `--sandbox read-only --ephemeral` (it can't drop its shell tool; the settings page warns about this).
- **The helper** only spawns `claude` / `agy` / `codex` via `spawn(exe, argsArray)` (never a shell string), validates CLI name, model (`^[A-Za-z0-9._:/-]{1,80}$`), text length, PNG-only images, runs in a fresh temp dir and deletes it. Keep it small.
- **API keys never reach a web page.** Only the service worker and extension pages read keys; content scripts receive answers only. With a master password, keys are stored only inside the encrypted `vault`; the derived key lives in `chrome.storage.session`. The password is optional (user's choice, the settings page warns): without one, keys sit plaintext in `chrome.storage.local` (`keys`), and `vault: false` there marks "no password chosen" (the default is still to ask for one) so a `config.json` vault doesn't come back. Never write plaintext keys to storage while a vault exists, and never export them in `config.json`.
- **The master password is typed only on extension pages** (`options.html`, `unlock.html`), never into the in-page popup (the page could capture keystrokes).
- **Popup:** keep the Shadow DOM `closed`, and render model output with `textContent`, never `innerHTML`.
- No `externally_connectable`, no `web_accessible_resources`, no broad host permissions (`activeTab` + `scripting` only).

## Gotchas learned the hard way

- **macOS privacy (TCC):** Brave can't read or execute files in `~/Documents`, `~/Desktop`, `~/Downloads` after a restart. The project must live elsewhere (currently `~/dev/brave-extension`), and `install.sh` copies the helper to `~/Library/Application Support/AskAI/`. Symptoms: extension vanishes after restarting Brave; `Specified native messaging host not found` (Brave logs "Found manifest, but not the binary").
- **This Brave build reads native-host manifests from the system folders** (`/Library/Application Support/Chromium/NativeMessagingHosts`, `/Library/Google/Chrome/NativeMessagingHosts`), so `./native-host/install.sh --system` (sudo) is needed. Re-run `install.sh` after changing `ask-ai-host.mjs`: Brave runs the installed copy, not the repo file.
- **Helper environment:** Brave starts it with a minimal env. The helper builds its own `PATH` (nix, Homebrew, npm-global) and must always include `/usr/bin` (Claude Code reads its login from the Keychain via `/usr/bin/security`) and set `HOME`/`USER` from `os.userInfo()`.
- **Extension ID** is fixed by `"key"` in the manifest: `aggkefdicohoiedeogpgpaeincnjngia`. The native host's `allowed_origins` depends on it; don't change or remove the key.
- **`chrome.storage.session`** is the only place the unlocked key may live; `refreshToolbar()` in `background.js` reacts to its changes.
- **Service worker:** it's an ES module (`"type": "module"`); a top-level throw shows as "Service worker registration failed. Status code: 3".
- **Injected content script state:** `content.js` guards with `window.__askGemini`; tabs opened before an extension reload keep the old script, so refresh tabs when testing.
- **Hotkeys:** `suggested_key` only applies on first install; ⌘⇧Y collides with macOS "Make New Sticky Note".
- **Model IDs change.** Suggestions in `PROVIDERS` are hints only; verify against provider docs before editing them. Don't send `max_tokens`/`temperature` to OpenAI models; `effort` isn't sent to Claude Haiku.
- Internal names still say "gemini" in places (`ask-gemini` command, `__askGemini*` globals, `#ask-gemini-root`); renaming the command would reset the user's hotkey.

## Testing

There is no test runner. Verify changes with:

- **Syntax:** `for f in *.js providers/*.js native-host/*.mjs; do node --check "$f"; done`
- **Logic with mocks:** small throwaway Node scripts that stub `globalThis.chrome` and `globalThis.fetch`, then `import` `llm.js` / `vault.js` / adapters directly (Node has WebCrypto, `btoa`, `AbortSignal.timeout`). Keep such scripts out of the repo.
- **Helper:** spawn `native-host/ask-ai-host.mjs` and send a 4-byte little-endian length + JSON on stdin; `{ "ping": true }` returns CLI status without using any plan quota. `./native-host/ask-ai-host.mjs --status` does the same from a shell.
- **In a real browser:** headless Brave with `--remote-debugging-port` and `--enable-unsafe-extension-debugging`, then CDP `Extensions.loadUnpacked` (`--load-extension` is ignored). The binary is at `~/Applications/Home Manager Apps/Brave Browser.app/Contents/MacOS/Brave Browser`. Add `--enable-logging=stderr` to see native-messaging errors.
- **Manual:** `cd test && python3 -m http.server`, open `localhost:8000/questions.html`, reload the extension at `brave://extensions`, refresh the tab.

Real requests through account CLIs or API keys cost the user quota or money: ask before sending them, and say plainly what was and wasn't verified.

## Environment

macOS, nix-darwin + Home Manager (Brave, Node and Claude Code come from nix; the nix store is read-only). `agy` and `codex` CLIs may not be installed.
