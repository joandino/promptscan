import OpenAI from "openai";
// Relative import to a file that isn't in the scan → must stay unresolved.
import { GHOST } from "./does-not-exist";

const client = new OpenAI();

const resp = client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "system", content: GHOST }],
});
