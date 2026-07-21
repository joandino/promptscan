const { ChatOpenAI } = require("@langchain/openai");
const llm = new ChatOpenAI({ model: "gpt-4o-mini" });
llm.invoke("Summarize the meeting notes into three bullet points.");
