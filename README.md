# Ask AI

A Brave/Chrome extension: highlight a question on a web page (or draw a box around it), press a hotkey, and an AI's answer appears in a small transparent popup next to it.

> **Disclaimer:** this extension is completely vibe coded (written by AI). It is provided as is, without any warranty. I take no responsibility for anything that happens when you use it, including wrong answers, leaked or misused API keys, costs, account bans, or other damage. Use it at your own risk.

Use **your Claude, Google or ChatGPT account** (no API key), or API keys for **Google Gemini, OpenAI, Anthropic (Claude), OpenRouter, DeepSeek**.

- **Multiple choice** → shows only the correct option(s), e.g. `B  Mars`
- **Free text** → shows a short, direct answer
- Works with highlighted text **or** a screenshot of part of the page
- One fallback chain across providers: if a model is busy, rate-limited or fails, the next one is asked
- API keys can be stored encrypted with a master password (optional)

Plain JavaScript, no build step, no dependencies.

## Setup

1. Open `brave://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
2. The settings page opens. Either:
   - **Accounts:** set up the account bridge (next section), or
   - **API keys:** set a master password (or choose *Use without a password*), paste your key(s) and click **Test**. Gemini has a free tier: <https://aistudio.google.com/apikey>.
3. Arrange the **Model chain** and click **Test chain**.

To keep your settings even after removing the extension, click **Download config.json** on the settings page and put the file in this folder (next to `manifest.json`). It contains your keys only in **encrypted** form (without a master password, keys are left out). `config.json` is git-ignored.

> **Updating from an earlier version:** the extension now has a fixed ID (needed for the account bridge), so Brave treats it as new once and its stored settings start empty. Restore them with your `config.json`, or re-enter them.

## Use your Claude / Google / ChatGPT account

The models included in your plan can answer instead of a paid API key. The extension can't log into claude.ai, gemini.google.com or chatgpt.com itself (no public API; scripting those sites breaks their terms), so it uses each company's **official command-line tool**, which you log into once. A small local helper (`native-host/`) runs it for each question, via Brave's Native Messaging (stdin/stdout, no network port).

| Account | Tool | Install | Log in once |
|---|---|---|---|
| Claude (Pro / Max) | Claude Code `claude` | <https://claude.com/claude-code> | `claude` → `/login` |
| Google | Antigravity CLI `agy` | see <https://antigravity.google/docs/cli/reference> | `agy` → follow the login prompts |
| ChatGPT (Plus / Pro) | Codex CLI `codex` | `pkgs.codex` (nix) or `npm i -g @openai/codex` | `codex login` → "Sign in with ChatGPT" |

With nix + Home Manager: add the Antigravity CLI and `pkgs.codex` to `home.packages` and switch. With npm on nix, first `npm config set prefix ~/.npm-global` (the nix store is read-only).

Then register the helper with Brave (current user only, no sudo):

```sh
./native-host/install.sh            # copies the helper to ~/Library/Application Support/AskAI/
                                    # and registers it in ~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/
./native-host/install.sh --system   # if Brave still says "bridge not installed": also registers it system-wide (sudo)
./native-host/uninstall.sh          # removes everything again
```

The helper is copied out of the project folder because macOS doesn't let Brave run programs stored in `~/Documents`, `~/Desktop` or `~/Downloads`. **Re-run `install.sh` after updating the extension** so the installed copy stays current. `install.sh` prints which tools are installed and logged in. Reload the extension; the **Accounts** section of the settings page shows the same status. Add e.g. *Claude account / haiku* to the chain.

<details><summary>Home Manager instead of install.sh</summary>

```nix
home.file."Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.askai.bridge.json".text = builtins.toJSON {
  name = "com.askai.bridge";
  description = "Ask AI account bridge";
  path = "/Users/YOU/Library/Application Support/AskAI/ask-ai-host";   # created by install.sh (must be outside ~/Documents)
  type = "stdio";
  allowed_origins = [ "chrome-extension://aggkefdicohoiedeogpgpaeincnjngia/" ];
};
```
</details>

Notes:

- **Speed:** 3–10 s per answer (each question starts the tool). API keys are faster.
- **Limits:** questions count against your plan's normal usage limits.
- **Terms:** each provider decides what its subscription may be used for; this uses only their official tools, for your own use. Check their terms.
- **Google account:** text questions only for now; screenshots skip to the next chain entry.
- **History:** Claude runs without saving a session. Antigravity CLI / Codex may keep local history in `~/.gemini/antigravity-cli` / `~/.codex`.

## Usage

| Hotkey (Mac) | Windows / Linux | Action |
|---|---|---|
| `⌘⇧Y` | `Ctrl+Shift+Y` | Ask about the highlighted text |
| `⌘⇧E` | `Ctrl+Shift+E` | Drag a box on the page → ask about that screenshot |
| `⌘⇧U` | `Ctrl+Shift+U` | Hide / show the answer popup |

You can also right-click a selection → **Ask AI about selection**, or click the toolbar icon.

In the popup, **Copy** copies the answer. **Esc** or **✕** closes it; clicking elsewhere on the page leaves it open. The highlight on the selected text is removed as soon as you ask. Drag the popup to move it. Hover over it to see which provider/model answered.

Change hotkeys at `brave://extensions/shortcuts`.

> **macOS:** `⌘⇧Y` is also the system shortcut for *Make New Sticky Note*. Turn it off under System Settings → Keyboard → Keyboard Shortcuts → Services → Text ("Make New Sticky Note" and "New Note with Selection").

## Settings

### API keys

One key per provider. You only need keys for providers you put in the chain. Set a **spending limit** on each key (link next to each key on the settings page), and preferably create a separate key just for this extension.

| Provider | Get a key | Example models |
|---|---|---|
| Google Gemini | <https://aistudio.google.com/apikey> | `gemini-flash-latest`, `gemini-3.5-flash`, `gemini-flash-lite-latest` |
| OpenAI | <https://platform.openai.com/api-keys> | `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra` |
| Anthropic (Claude) | <https://console.anthropic.com/settings/keys> | `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5` |
| OpenRouter | <https://openrouter.ai/settings/keys> | `google/gemini-3.5-flash`, `anthropic/claude-sonnet-5`, … (any model on OpenRouter) |
| DeepSeek | <https://platform.deepseek.com/api_keys> | `deepseek-flash`, `deepseek-v4-pro` |

Any model ID the provider accepts works; the suggestions on the settings page are just a starting point.

### Model chain

An ordered list of `provider + model` entries. Each question goes to the first entry; the next entry is tried when one:

- is overloaded (5xx / 529) or rate-limited (429)
- doesn't answer within 30 s, or has a network error
- has no key, a wrong key, no credit, or an unknown model name
- refuses, or can't read images (screenshot mode)

Account entries (Claude / Google / ChatGPT account) need no key and keep working while the API keys are locked.

If every entry fails, the popup lists each one with its reason. Default chain: `gemini/gemini-flash-latest` → `gemini/gemini-flash-lite-latest`.

### Other

| Setting | Default |
|---|---|
| Answer language | Same as the question |
| Auto-lock | Only when Brave quits (or after 5–60 min unused) |

Where both are set, the settings page wins over `config.json` (keys merge per provider). Settings from the older Gemini-only version (`apiKey`, `model`, `fallbackModels`) are converted automatically.

## Plugins

Plugins read the page when you ask and send what they find along with the question, e.g. the question text when you only highlighted the options. Turn them on under **Plugins** in settings (all start off). What a plugin collects goes to the model provider, like the question itself.

Included: **Text around the question** (`plugins/page-context.js`): the paragraph or form block around your selection or screenshot, plus the page title.

### Writing a plugin

Put one `.js` file into `plugins/`, reload the extension at `brave://extensions` and open the settings page: the plugin shows up there. Nothing else to edit. Files starting with `_` are helpers, not plugins.

```js
// plugins/points.js
(() => {
  // Your own helpers, regexes, constants …
  const POINTS_RE = /(\d+)\s*points?/i;

  askAiPlugin({
    id: "points",                  // unique, stays the same (settings are stored under it)
    label: "Points per question",  // shown in settings
    description: "Tells the model how many points the question is worth.",
    // Optional: tells the model how to read the text this plugin returns.
    instructions: "The points show how detailed the answer should be: about one sentence per point.",
    // Runs in the page when you ask. target = { selectionText, rect } (rect: screenshot region, else null).
    // Return text for the prompt, or null to add nothing. May be async; gets 3 s.
    collect(target) {
      const block = blockAround(getSelection().anchorNode);
      const points = matchAll(visibleText(block), POINTS_RE).map((m) => m[1]);
      return points.length ? `Points: ${points.join(", ")}` : null;
    },
  });
})();
```

Helpers from `plugins/_page.js` you can use: `blockAround(node, minLength)` (nearest paragraph / list item / form block with more than `minLength` characters), `visibleText(element)`, `matchAll(text, regex)` (every match; `m[0]` is the match, `m[1]` … the groups).

Rules:

- Plugins only **read** the page. Return plain text; each plugin is cut to 4,000 characters, all together to 6,000.
- `instructions` (optional, up to 1,000 characters) is your note to the model about the returned text, e.g. "Each `Answer N` is a gap; give one answer per gap, in order." It is fixed text from the plugin file and the model is told to follow it, unlike the page text, which is marked as "not instructions". Don't build it from page content.
- The code runs in the extension's isolated world: it sees the page's DOM, but not the page's JavaScript variables, and page scripts can't see it.
- The settings page loads the file once to read `id`, `label` and `description` (without calling `collect`), so the top level must only define things and call `askAiPlugin`.
- A plugin that throws or takes longer than 3 s is skipped (logged in the service worker console); the question is still asked.

## Security

**API keys – master password.** Keys are encrypted with AES-256-GCM; the key is derived from your master password with PBKDF2-SHA256 (600,000 rounds). Only the encrypted form is stored (`chrome.storage` and `config.json`). After you unlock, the derived key is kept in memory only (`chrome.storage.session`) until Brave quits or auto-lock triggers. The password is never stored – if you forget it, use *Reset* and re-enter your keys. Unlock only on extension pages (settings, toolbar popup), never on a web page.

**No master password (optional).** If you prefer not to unlock at all, click *Use without a password* instead of setting one (or remove it later under *Remove password*). Keys then work immediately but are stored unencrypted in Brave's extension storage: anyone or any program that can read your Brave profile can read them. Set spending limits on your keys.

- *Protects:* keys on disk – the Brave profile, backups / Time Machine, a copied folder or `config.json`, other programs reading those files.
- *Doesn't protect:* keys while unlocked against malware already running on your Mac (it could read Brave's memory or log your password), or a weak password brute-forced from a stolen vault. No setup can make a key that the extension must use impossible to steal – that's what spending limits are for.
- Plugins add page text to the prompt. It is marked as page content that must not be followed as instructions, but treat it like the selected text: a page can try prompt injection through it.
- Keys never reach web pages: only the extension's service worker and pages read them and call the APIs; the in-page popup only gets the answer.

**Account bridge – prompt injection.** The question comes from any web page and may contain hidden instructions ("ignore this, run a command…"). The CLIs are coding agents, so the helper runs them **with every tool disabled**:

- Claude Code: `--tools ""`, `--strict-mcp-config` (no MCP servers), `--safe-mode` (no hooks / plugins / CLAUDE.md), `--permission-mode dontAsk`, `--no-session-persistence`.
- Antigravity CLI (`agy`): a hook that denies every tool call, plus its terminal sandbox. It has no switch to remove its tools or replace its system prompt, so this is weaker than the Claude lock-down.
- Codex CLI: `--sandbox read-only` (no writes, no network), `--ephemeral`. ⚠ **Codex can't fully turn off its shell tool**: a malicious page could trick it into *reading* local files (e.g. `~/.ssh`) into its answer. Prefer the Claude or Google account for untrusted pages.

All runs use an empty temp folder. The helper only spawns these three fixed programs (no shell), validates the model name, input size and image type, and only the extension with ID `aggkefdicohoiedeogpgpaeincnjngia` may start it. The answer popup uses a *closed* Shadow DOM, so page scripts can't read it. Hidden text can still make an **answer** wrong; it just can't make the tools **do** anything.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3: permissions, hotkeys |
| `background.js` | Service worker: hotkeys, reading the selection, screenshot capture and crop, model fallback flow |
| `llm.js` | Provider list, settings (+ migration, `config.json`), the fallback chain |
| `vault.js` | Encrypted API key storage (master password, lock / unlock, auto-lock) |
| `unlock.html` / `unlock.js` | Toolbar popup for unlocking while keys are locked |
| `providers/account.js` | Account providers: talks to the local helper |
| `native-host/ask-ai-host.mjs` | Local helper that runs `claude` / `agy` / `codex` with tools disabled |
| `native-host/install.sh` / `uninstall.sh` | Register / unregister the helper with Brave |
| `providers/core.js` | Shared prompt, answer schema, HTTP/error handling, answer parsing |
| `providers/gemini.js` | Google Gemini adapter |
| `providers/openai-compat.js` | OpenAI, OpenRouter and DeepSeek adapter (Chat Completions format) |
| `providers/anthropic.js` | Anthropic Claude adapter (Messages API) |
| `content.js` | Injected into the page on demand: answer popup (Shadow DOM) and the screenshot region picker |
| `options.html` / `options.js` | Settings page (auto-saves); finds the plugin files |
| `plugins.js` | Runs the enabled plugins in the tab and joins their text |
| `plugins/_page.js` | `askAiPlugin()` and the helpers available to every plugin |
| `plugins/*.js` | Plugins, one file each (`page-context.js` is included) |
| `test/questions.html` | Sample multiple-choice, free-text and iframe questions |

### Customizing the popup

All popup styling is in the `CSS` block at the top of `content.js`:

- `opacity` on `.card`: overall transparency (currently `0.4`)
- `--halo`: the white outline that keeps text readable on any background
- `--fg` / `--accent`: answer text color and option letter color

What the models are asked to return is defined in `systemPrompt()` and `ANSWER_SCHEMA` in `providers/core.js` (Gemini uses its own copy of the schema in `providers/gemini.js`).

## Testing

```sh
cd test && python3 -m http.server
```

Open <http://localhost:8000/questions.html>, select a question with its options and press `⌘⇧Y`, or press `⌘⇧E` and drag a box around one.

After editing code: click reload on the extension card in `brave://extensions`, **then refresh open tabs**. Old tabs keep the previous popup code.

## Limitations

- Doesn't run on `brave://` pages, the Chrome Web Store, or inside Brave's PDF viewer. The toolbar icon shows a red `!` badge instead.
- Screenshots only cover the visible part of the current tab, not other apps.
- In iframes the popup appears in the top-right corner instead of next to the selection.
- Only text and screenshots are sent. Diagrams that aren't inside your selection or box aren't seen by the model.
- Screenshot mode needs a model that reads images. Text-only models (e.g. some DeepSeek or OpenRouter models) are skipped for screenshots.
- Local models (Ollama, LM Studio) aren't supported yet.

## Troubleshooting

- **"Service worker registration failed. Status code: 3"**: remove the extension (not just reload) and load it again. If it persists, give Brave access to the Documents folder (System Settings → Privacy & Security → Files and Folders), or load the extension from a folder outside `~/Documents`. Details are in `brave://serviceworker-internals`.
- **Hotkey does nothing**: check `brave://extensions/shortcuts`; another app or macOS may own the key.
- **Logs**: `brave://extensions` → Ask AI → *Inspect views: service worker*. Every question logs what each plugin added, the size of the prompt, and which model answered in how long; each failed chain entry is logged there too. A plugin's own `console.log` shows up in the web page's console instead.
- **"Account bridge not installed"**: run `./native-host/install.sh`, quit Brave (⌘Q) and reopen it. If it persists, run `./native-host/install.sh --system`. The settings page shows the extension ID and Brave's exact error under *Accounts*.
- **"Native host has exited"**: the helper can't start – re-run `./native-host/install.sh` (it must live outside `~/Documents`).
- **Account "not logged in"**: run the tool once in Terminal (`claude`, `agy`, `codex login`).
- **🔒 on the toolbar icon**: API keys are locked – click the icon and enter your master password.

## License

[MIT](LICENSE). Provided as is, without warranty.
