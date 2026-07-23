import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const model = openai("gpt-4o");

const result = generateText({
  model,
  prompt: "Classify this ticket by urgency and route it to the right queue.",
});
