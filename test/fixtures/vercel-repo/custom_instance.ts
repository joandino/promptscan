import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const myai = createOpenAI({ baseURL: "https://gateway.example.com/v1" });

const result = generateText({
  model: myai("gpt-4o"),
  prompt: "Draft a friendly reminder about the upcoming maintenance window.",
});
