// Google Gemini (generateContent REST API).
import { LlmError, parseAnswer, postJson, screenshotPrompt, systemPrompt, withFormatFallback } from "./core.js";

// Gemini's OpenAPI-style schema (uppercase types).
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    type: { type: "STRING", format: "enum", enum: ["multiple_choice", "free_text"] },
    correct_options: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, text: { type: "STRING" } },
        required: ["label", "text"],
      },
    },
    answer: { type: "STRING" },
  },
  required: ["type", "answer"],
  propertyOrdering: ["type", "correct_options", "answer"],
};

function userParts(input) {
  if (typeof input === "string") return [{ text: input }];
  return [
    { inlineData: { mimeType: input.image.mimeType, data: input.image.data } },
    { text: screenshotPrompt() },
  ];
}

export async function ask({ input, model, apiKey, language }) {
  return withFormatFallback(async (strict) => {
    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      {
        systemInstruction: { parts: [{ text: systemPrompt(language) }] },
        contents: [{ role: "user", parts: userParts(input) }],
        generationConfig: strict
          ? { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
          : { responseMimeType: "application/json" },
      },
      { image: typeof input !== "string" },
    );
    const candidate = json?.candidates?.[0];
    const raw = (candidate?.content?.parts || [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    if (!raw) {
      const reason = candidate?.finishReason || json?.promptFeedback?.blockReason || "unknown";
      throw new LlmError(`No answer (reason: ${reason}).`);
    }
    return parseAnswer(raw);
  });
}
