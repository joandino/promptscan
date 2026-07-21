import OpenAI from "openai";
const client = new OpenAI();
const SYS = "You are a precise assistant. Keep answers under three sentences.";
async function ask(q: string) {
  return client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `Please answer: ${q}` },
    ],
  });
}
