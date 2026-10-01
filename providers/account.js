// Account providers: the local helper (native-host/) runs the official CLIs the user is logged into.
import { ANSWER_SCHEMA, LlmError, parseAnswer, systemPrompt } from "./core.js";

export const BRIDGE_HOST = "com.askai.bridge";
export const BRIDGE_MISSING = "Account bridge not installed – run native-host/install.sh";

const CLI = { "claude-account": "claude", "gemini-account": "agy", "chatgpt-account": "codex" };

export function sendToBridge(message) {
  return new Promise((resolve, reject) => {
    // An old copy of the extension (loaded before "nativeMessaging" was added) has no such API.
    if (!chrome.runtime.sendNativeMessage) {
      return reject(new LlmError("This copy of the extension has an old ID – remove it in brave://extensions and keep the newer one.", { needsSettings: true }));
    }
    chrome.runtime.sendNativeMessage(BRIDGE_HOST, message, (response) => {
      const error = chrome.runtime.lastError;
      if (!error) return resolve(response);
      const missing = /not found|forbidden/i.test(error.message);
      reject(new LlmError(missing ? `${BRIDGE_MISSING} (Brave: "${error.message}")` : `Bridge error: ${error.message}`, { needsSettings: missing }));
    });
  });
}

// { claude: { installed, loggedIn }, agy: …, codex: … }
export async function bridgeStatus() {
  const response = await sendToBridge({ ping: true });
  return response?.status || {};
}

export function adapter(provider) {
  return async function ask({ input, model, language }) {
    const response = await sendToBridge({
      cli: CLI[provider],
      model,
      input,
      system: systemPrompt(language),
      schema: ANSWER_SCHEMA,
    });
    if (!response?.ok) {
      const setupProblem = response?.kind === "not-installed" || response?.kind === "not-logged-in";
      throw new LlmError(response?.message || "No answer from the bridge.", { needsSettings: setupProblem });
    }
    return parseAnswer(response.raw);
  };
}
