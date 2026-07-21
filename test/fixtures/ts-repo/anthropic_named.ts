import { Anthropic } from "@anthropic-ai/sdk";
const client = new Anthropic();
await client.messages.create({
  model: "claude-sonnet-5",
  system: "You are a helpful reviewer.",
  max_tokens: 1024,
  messages: [{ role: "user", content: "hello" }],
});
