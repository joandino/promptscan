import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = generateText({
  model: openai("gpt-4o"),
  system: "You are a careful reviewer of pull requests at Acme.",
  messages: [{ role: "user", content: "Review this diff and flag risky changes." }],
});
