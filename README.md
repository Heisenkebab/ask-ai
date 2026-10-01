# Ask Gemini

A Brave/Chrome extension: highlight a question on a web page (or draw a box around it), press a hotkey, and Gemini's answer appears in a small transparent popup next to it.

- **Multiple choice** → shows only the correct option(s), e.g. `B  Mars`
- **Free text** → shows a short, direct answer
- Works with highlighted text **or** a screenshot of part of the page
- Falls back to other models automatically when one is overloaded or rate-limited

Plain JavaScript, no build step, no dependencies.

## Setup

1. Get a free API key at <https://aistudio.google.com/apikey>.
2. Open `brave://extensions`, turn on **Developer mode**, click **Load unpacked** and select this folder.
3. The settings page opens. Paste your key, then click **Test key**.

To keep your settings even after removing the extension, click **Download config.json** on the settings page and put the file in this folder (next to `manifest.json`). You can also copy `config.example.json` to `config.json` and fill it in by hand. `config.json` is git-ignored.

## Usage

| Hotkey (Mac) | Windows / Linux | Action |
|---|---|---|
| `⌘⇧Y` | `Ctrl+Shift+Y` | Ask about the highlighted text |
| `⌘⇧E` | `Ctrl+Shift+E` | Drag a box on the page → ask about that screenshot |
| `⌘⇧U` | `Ctrl+Shift+U` | Hide / show the answer popup |

You can also right-click a selection → **Ask Gemini about selection**, or click the toolbar icon.

In the popup, **Copy** copies the answer. **Esc** or a click outside closes it. Drag the popup to move it. Hover over it to see which model answered.

Change hotkeys at `brave://extensions/shortcuts`.

> **macOS:** `⌘⇧Y` is also the system shortcut for *Make New Sticky Note*. Turn it off under System Settings → Keyboard → Keyboard Shortcuts → Services → Text ("Make New Sticky Note" and "New Note with Selection").

## Settings

| Setting | Default | Notes |
|---|---|---|
| API key | – | Stored only in this browser (`chrome.storage.local`) or in `config.json` |
| Model | `gemini-flash-latest` | Any Gemini model ID, e.g. `gemini-3.5-flash`, `gemini-flash-lite-latest` |
| Fallback models | `gemini-flash-lite-latest, gemini-flash-latest` | Tried in order on overload (5xx), rate limit (429), timeout (30 s), network error or unknown model |
| Answer language | Same as the question | |

Where both are set, the settings page wins over `config.json`. Empty fields don't override.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3: permissions, hotkeys |
| `background.js` | Service worker: hotkeys, reading the selection, screenshot capture and crop, model fallback flow |
| `gemini.js` | Gemini REST call, prompt, JSON response schema, settings loading |
| `content.js` | Injected into the page on demand: answer popup (Shadow DOM) and the screenshot region picker |
| `options.html` / `options.js` | Settings page (auto-saves) |
| `test/questions.html` | Sample multiple-choice, free-text and iframe questions |

### Customizing the popup

All popup styling is in the `CSS` block at the top of `content.js`:

- `opacity` on `.card`: overall transparency (currently `0.4`)
- `--halo`: the white outline that keeps text readable on any background
- `--fg` / `--accent`: answer text color and option letter color

What Gemini is asked to return is defined in `systemPrompt()` and `RESPONSE_SCHEMA` in `gemini.js`.

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
- Gemini only. Other providers (OpenAI-compatible APIs, OpenRouter, local models) aren't supported yet.

## Troubleshooting

- **"Service worker registration failed. Status code: 3"**: remove the extension (not just reload) and load it again. If it persists, give Brave access to the Documents folder (System Settings → Privacy & Security → Files and Folders), or load the extension from a folder outside `~/Documents`. Details are in `brave://serviceworker-internals`.
- **Hotkey does nothing**: check `brave://extensions/shortcuts`; another app or macOS may own the key.
- **Logs**: `brave://extensions` → Ask Gemini → *Inspect views: service worker*.
