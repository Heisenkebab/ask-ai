// Shared pieces for all provider adapters: prompt, answer schema, HTTP + error handling, parsing.

export class LlmError extends Error {
  constructor(message, { needsSettings = false, formatRejected = false } = {}) {
    super(message);
    // The key or model in settings is the likely cause: the popup offers "Open settings".
    this.needsSettings = needsSettings;
    // The provider rejected the structured-output request; adapters retry without it.
    this.formatRejected = formatRejected;
  }
}

const TIMEOUT_MS = 30000;
const SCREENSHOT_PROMPT = "Answer the question shown in this screenshot.";

// Standard JSON Schema for the answer (OpenAI, OpenRouter, Anthropic).
export const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["multiple_choice", "free_text"] },
    correct_options: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, text: { type: "string" } },
        required: ["label", "text"],
        additionalProperties: false,
      },
    },
    answer: { type: "string" },
  },
  required: ["type", "correct_options", "answer"],
  additionalProperties: false,
};

export function systemPrompt(language) {
  const lang = !language || language === "auto" ? "the same language as the question" : language;
  return [
    "You answer questions that the user highlighted on a web page or cut out as a screenshot.",
    "For a screenshot, read the question and its options from the image; checkboxes, radio buttons or letters next to options are the option labels.",
    "First decide whether it is a multiple-choice question (it lists answer options) or an open/free-text question.",
    "For multiple choice: set type to \"multiple_choice\", list ALL correct options in correct_options using the option's own label (e.g. \"A\", \"b)\", \"1\") or, if the options are unlabeled, number them by position starting at 1; set answer to just the correct option label(s). No reasoning or extra context.",
    "For free text: set type to \"free_text\", leave correct_options empty and give a concise, direct answer in answer. No explanation.",
    `Write the answer in ${lang}.`,
    'Reply with JSON only, shaped like {"type": "...", "correct_options": [{"label": "...", "text": "..."}], "answer": "..."}.',
  ].join("\n");
}

export function screenshotPrompt() {
  return SCREENSHOT_PROMPT;
}

// POST JSON with a timeout. Returns the parsed body; throws LlmError for every failure.
export async function postJson(url, headers, body, { image = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new LlmError(e.name === "TimeoutError" ? `No response after ${TIMEOUT_MS / 1000}s` : `Network error: ${e.message}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw statusError(res.status, json?.error?.message || res.statusText, { image });
  return json;
}

function statusError(status, apiMsg, { image }) {
  if (status === 401 || status === 403 || (status === 400 && /api[ _-]?key/i.test(apiMsg))) {
    return new LlmError("Invalid API key or no access.", { needsSettings: true });
  }
  if (status === 402) return new LlmError("No credit left on this account.", { needsSettings: true });
  if (status === 404) return new LlmError("Model not found (check the name in settings).", { needsSettings: true });
  if (status === 429) return new LlmError("Rate limit hit.");
  if (status >= 500) return new LlmError(`Overloaded or unavailable (${status}).`);
  if (status === 400 && image && /image|vision|multimodal/i.test(apiMsg)) {
    return new LlmError("This model can't read images.");
  }
  if (status === 400 && /response_format|json_schema|json_object|output_config|format|schema|effort/i.test(apiMsg)) {
    return new LlmError(`Structured output not supported: ${apiMsg}`, { formatRejected: true });
  }
  if (status === 400 && image) return new LlmError("This model can't read images.");
  return new LlmError(`Error ${status}: ${apiMsg}`);
}

// Turns the model's reply into { type, correct_options, answer }, tolerating text around the JSON.
export function parseAnswer(raw) {
  if (!raw || !raw.trim()) throw new LlmError("Empty answer.");
  let data = null;
  for (const candidate of [raw, raw.match(/\{[\s\S]*\}/)?.[0]]) {
    try {
      data = candidate && JSON.parse(candidate);
      if (data && typeof data === "object") break;
    } catch {
      data = null;
    }
  }
  if (!data) return { type: "free_text", correct_options: [], answer: raw.trim() };
  const options = Array.isArray(data.correct_options)
    ? data.correct_options.filter((o) => o && o.label != null).map((o) => ({ label: String(o.label), text: String(o.text ?? "") }))
    : [];
  return {
    type: data.type === "multiple_choice" ? "multiple_choice" : "free_text",
    correct_options: options,
    answer: String(data.answer ?? ""),
  };
}

// Runs request(strict=true); if the provider rejects structured output, retries once without it.
export async function withFormatFallback(request) {
  try {
    return await request(true);
  } catch (e) {
    if (e instanceof LlmError && e.formatRejected) return request(false);
    throw e;
  }
}
