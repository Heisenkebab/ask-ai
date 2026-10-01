// Thin wrapper around the Gemini generateContent REST API.

export const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-flash-latest",
  fallbackModels: "gemini-flash-lite-latest, gemini-flash-latest",
  language: "auto",
};

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

// Priority: settings page > config.json > defaults. Empty values don't override.
export async function getSettings() {
  const [file, stored] = await Promise.all([getFileSettings(), chrome.storage.local.get(null)]);
  const settings = { ...DEFAULT_SETTINGS };
  for (const source of [file, stored]) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof source[key] === "string" && source[key].trim()) settings[key] = source[key].trim();
    }
  }
  return settings;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", format: "enum", enum: ["multiple_choice", "free_text"] },
    correct_options: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          text: { type: "STRING" },
        },
        required: ["label", "text"],
      },
    },
    answer: { type: "STRING" },
    explanation: { type: "STRING" },
  },
  required: ["type", "answer"],
  propertyOrdering: ["type", "correct_options", "answer", "explanation"],
};

function systemPrompt(language) {
  const lang =
    !language || language === "auto"
      ? "the same language as the question"
      : language;
  return [
    "You answer questions that the user highlighted on a web page or cut out as a screenshot.",
    "For a screenshot, read the question and its options from the image; checkboxes, radio buttons or letters next to options are the option labels.",
    "First decide whether the text is a multiple-choice question (it lists answer options) or an open/free-text question.",
    "For multiple choice: set type to \"multiple_choice\", list ALL correct options in correct_options using the option's own label (e.g. \"A\", \"b)\", \"1\") or, if the options are unlabeled, number them by position starting at 1; set answer to just the correct option label(s). Leave explanation empty: no reasoning or extra context.",
    "For free text: set type to \"free_text\", leave correct_options empty, give a concise, direct answer in answer. Leave explanation empty.",
    `Write the answer in ${lang}.`,
  ].join("\n");
}

export class GeminiError extends Error {
  constructor(message, { needsSettings = false, retryable = false } = {}) {
    super(message);
    this.needsSettings = needsSettings;
    // Retryable errors are tied to one model (overloaded, quota, missing), so another model may work.
    this.retryable = retryable;
  }
}

const TIMEOUT_MS = 30000;

// Primary model first, then the fallbacks, without duplicates.
export function modelChain(settings) {
  const list = [settings.model, ...(settings.fallbackModels || "").split(",")]
    .map((m) => (m || "").trim())
    .filter(Boolean);
  return [...new Set(list.length ? list : [DEFAULT_SETTINGS.model])];
}

// input is the question text, or { image: { mimeType, data } } with base64 data for a screenshot.
// Tries each model in turn; onRetry(nextModel, error) is called before every fallback.
export async function askGemini(input, settings, onRetry = () => {}) {
  if (!settings.apiKey) {
    throw new GeminiError("No Gemini API key set.", { needsSettings: true });
  }
  const models = modelChain(settings);
  const failures = [];
  for (const [i, model] of models.entries()) {
    try {
      const data = await askModel(input, model, settings);
      return { ...data, model };
    } catch (e) {
      if (!(e instanceof GeminiError) || !e.retryable) throw e;
      failures.push(`${model}: ${e.message}`);
      console.warn(`[Ask Gemini] ${model} failed, ${i + 1 < models.length ? "trying next model" : "no models left"}:`, e.message);
      if (i + 1 < models.length) onRetry(models[i + 1], e);
    }
  }
  throw new GeminiError(
    failures.length === 1 ? failures[0] : `All models failed:\n${failures.join("\n")}`,
  );
}

function userParts(input) {
  if (typeof input === "string") return [{ text: input }];
  return [
    { inlineData: { mimeType: input.image.mimeType, data: input.image.data } },
    { text: "Answer the question shown in this screenshot." },
  ];
}

async function askModel(input, model, settings) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(settings.language) }] },
    contents: [{ role: "user", parts: userParts(input) }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e.name === "TimeoutError" ? `No response after ${TIMEOUT_MS / 1000}s` : `Network error: ${e.message}`;
    throw new GeminiError(msg, { retryable: true });
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const apiMsg = json?.error?.message || res.statusText;
    if (res.status === 400 && /api key/i.test(apiMsg)) {
      throw new GeminiError("Invalid API key.", { needsSettings: true });
    }
    if (res.status === 403) {
      throw new GeminiError(`Access denied: ${apiMsg}`, { needsSettings: true });
    }
    if (res.status === 404) {
      throw new GeminiError("Model not found (check the name in settings).", { retryable: true });
    }
    if (res.status === 429) {
      throw new GeminiError("Rate limit hit.", { retryable: true });
    }
    if (res.status >= 500) {
      throw new GeminiError(`Overloaded or unavailable (${res.status}).`, { retryable: true });
    }
    throw new GeminiError(`Gemini error ${res.status}: ${apiMsg}`);
  }

  const candidate = json?.candidates?.[0];
  const raw = (candidate?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  if (!raw) {
    const reason = candidate?.finishReason || json?.promptFeedback?.blockReason || "unknown";
    throw new GeminiError(`Gemini returned no answer (reason: ${reason}).`);
  }

  try {
    const data = JSON.parse(raw);
    data.correct_options = Array.isArray(data.correct_options) ? data.correct_options : [];
    if (data.type === "multiple_choice") data.explanation = "";
    return data;
  } catch {
    // Structured output should always be JSON; fall back to showing the raw text.
    return { type: "free_text", correct_options: [], answer: raw, explanation: "" };
  }
}
