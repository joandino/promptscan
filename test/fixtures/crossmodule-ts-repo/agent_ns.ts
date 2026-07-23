import OpenAI from "openai";
import * as prompts from "./prompts";

const client = new OpenAI();

const resp = client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "system", content: prompts.SYSTEM_PROMPT }],
});
