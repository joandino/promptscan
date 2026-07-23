import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const result = streamText({
  model: anthropic("claude-3-5-sonnet-20241022"),
  prompt: "Summarize the incident timeline for the status page in three sentences.",
});
