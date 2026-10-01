# Ask AI

A Brave/Chrome extension: highlight a question on a web page (or draw a box around it), press a hotkey, and an AI's answer appears in a small transparent popup next to it.

Supported providers: **Google Gemini, OpenAI, Anthropic (Claude), OpenRouter, DeepSeek**.

- **Multiple choice** → shows only the correct option(s), e.g. `B  Mars`
- **Free text** → shows a short, direct answer
- Works with highlighted text **or** a screenshot of part of the page
- One fallback chain across providers: if a model is busy, rate-limited or fails, the next one is asked

Plain JavaScript, no build step, no dependencies.

## Setup

1. Get an API key from at least one provider. Gemini has a free tier: <https://aistudio.google.com/apikey>.
2. Open `brave://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
3. The settings page opens. Paste your key(s), click **Test** next to each, then arrange the **Model chain** and click **Test chain**.

To keep your settings even after removing the extension, click **Download config.json** on the settings page and put the file in this folder (next to `manifest.json`). You can also copy `config.example.json` to `config.json` and fill it in by hand. `config.json` is git-ignored.

## Usage

| Hotkey (Mac) | Windows / Linux | Action |
|---|---|---|
| `⌘⇧Y` | `Ctrl+Shift+Y` | Ask about the highlighted text |
| `⌘⇧E` | `Ctrl+Shift+E` | Drag a box on the page → ask about that screenshot |
| `⌘⇧U` | `Ctrl+Shift+U` | Hide / show the answer popup |

You can also right-click a selection → **Ask AI about selection**, or click the toolbar icon.

In the popup, **Copy** copies the answer. **Esc** or a click outside closes it. Drag the popup to move it. Hover over it to see which provider/model answered.

Change hotkeys at `brave://extensions/shortcuts`.

> **macOS:** `⌘⇧Y` is also the system shortcut for *Make New Sticky Note*. Turn it off under System Settings → Keyboard → Keyboard Shortcuts → Services → Text ("Make New Sticky Note" and "New Note with Selection").

## Settings

### API keys

One key per provider. You only need keys for providers you put in the chain.

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

If every entry fails, the popup lists each one with its reason. Default chain: `gemini/gemini-flash-latest` → `gemini/gemini-flash-lite-latest`.

### Other

| Setting | Default |
|---|---|
| Answer language | Same as the question |

Where both are set, the settings page wins over `config.json` (keys merge per provider). Settings from the older Gemini-only version (`apiKey`, `model`, `fallbackModels`) are converted automatically.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3: permissions, hotkeys |
| `background.js` | Service worker: hotkeys, reading the selection, screenshot capture and crop, model fallback flow |
| `llm.js` | Provider list, settings (+ migration, `config.json`), the fallback chain |
| `providers/core.js` | Shared prompt, answer schema, HTTP/error handling, answer parsing |
| `providers/gemini.js` | Google Gemini adapter |
| `providers/openai-compat.js` | OpenAI, OpenRouter and DeepSeek adapter (Chat Completions format) |
| `providers/anthropic.js` | Anthropic Claude adapter (Messages API) |
| `content.js` | Injected into the page on demand: answer popup (Shadow DOM) and the screenshot region picker |
| `options.html` / `options.js` | Settings page (auto-saves) |
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
- **Logs**: `brave://extensions` → Ask AI → *Inspect views: service worker*. Each failed chain entry is logged there.
