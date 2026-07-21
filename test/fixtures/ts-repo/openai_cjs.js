const OpenAI = require("openai");
const client = new OpenAI();
client.responses.create({ model: "gpt-4.1", input: "Summarize the release." });
