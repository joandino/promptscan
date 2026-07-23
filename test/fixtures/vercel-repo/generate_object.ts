import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";

const result = generateObject({
  model: openai("gpt-4o-mini"),
  messages: [{ role: "system", content: "You extract structured fields from support tickets." }],
});
