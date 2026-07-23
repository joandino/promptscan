import { generateText } from "ai";
import { google } from "@ai-sdk/google";

// A provider PromptScan can't natively tokenize/price → reported as 'other'.
const result = generateText({
  model: google("gemini-1.5-pro"),
  prompt: "Explain the difference between a mutex and a semaphore.",
});
