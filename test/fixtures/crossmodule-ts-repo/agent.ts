import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./prompts";

const client = new OpenAI();

const resp = client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Review this diff." },
  ],
});
