// Anthropic Claude (Messages API), called directly from the extension.
import { ANSWER_SCHEMA, LlmError, parseAnswer, postJson, screenshotPrompt, systemPrompt, withFormatFallback } from "./core.js";

function userContent(input) {
  if (typeof input === "string") return [{ type: "text", text: input }];
  return [
    { type: "image", source: { type: "base64", media_type: input.image.mimeType, data: input.image.data } },
    { type: "text", text: screenshotPrompt() },
  ];
}

export async function ask({ input, model, apiKey, language }) {
  return withFormatFallback(async (strict) => {
    const body = {
      model,
      max_tokens: 16000,
      system: systemPrompt(language),
      messages: [{ role: "user", content: userContent(input) }],
    };
    if (strict) {
      body.output_config = { format: { type: "json_schema", schema: ANSWER_SCHEMA } };
      // Low effort keeps short answers fast; Haiku doesn't support the effort setting.
      if (!/haiku/i.test(model)) body.output_config.effort = "low";
    }
    const json = await postJson(
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required for requests from a browser or extension origin.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
      { image: typeof input !== "string" },
    );
    if (json?.stop_reason === "refusal") throw new LlmError("Refused by the model.");
    const raw = (json?.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseAnswer(raw);
  });
}
