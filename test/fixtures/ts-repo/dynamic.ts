import OpenAI from "openai";
const client = new OpenAI();
client.chat.completions.create({ model: model, messages: buildMessages() });
