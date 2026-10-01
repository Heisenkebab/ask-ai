// OpenAI-style Chat Completions: used for OpenAI, OpenRouter and DeepSeek.
import { ANSWER_SCHEMA, LlmError, parseAnswer, postJson, screenshotPrompt, systemPrompt, withFormatFallback } from "./core.js";

const CONFIGS = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    format: "json_schema",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    format: "json_schema",
    headers: { "X-Title": "Ask AI extension" },
  },
  deepseek: {
    url: "https://api.deepseek.com/chat/completions",
    // DeepSeek only offers JSON mode; the shape comes from the system prompt.
    format: "json_object",
  },
};

function userContent(input) {
  if (typeof input === "string") return input;
  return [
    { type: "image_url", image_url: { url: `data:${input.image.mimeType};base64,${input.image.data}` } },
    { type: "text", text: screenshotPrompt() },
  ];
}

function responseFormat(kind) {
  if (kind === "json_object") return { type: "json_object" };
  return { type: "json_schema", json_schema: { name: "answer", strict: true, schema: ANSWER_SCHEMA } };
}

export function adapter(provider) {
  const config = CONFIGS[provider];
  return async function ask({ input, model, apiKey, language }) {
    return withFormatFallback(async (strict) => {
      const body = {
        model,
        messages: [
          { role: "system", content: systemPrompt(language) },
          { role: "user", content: userContent(input) },
        ],
      };
      if (strict) body.response_format = responseFormat(config.format);
      const json = await postJson(
        config.url,
        { Authorization: `Bearer ${apiKey}`, ...config.headers },
        body,
        { image: typeof input !== "string" },
      );
      // OpenRouter reports upstream failures inside a 200 response.
      if (json?.error) throw new LlmError(`Provider error: ${json.error.message || json.error.code || "unknown"}`);
      const choice = json?.choices?.[0];
      const message = choice?.message;
      if (message?.refusal) throw new LlmError(`Refused: ${message.refusal}`);
      if (choice?.finish_reason === "content_filter") throw new LlmError("Blocked by the content filter.");
      const raw = Array.isArray(message?.content)
        ? message.content.map((p) => p.text || "").join("")
        : message?.content;
      return parseAnswer(raw || "");
    });
  };
}
