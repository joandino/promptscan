import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";

const model = new ChatAnthropic({ model: "claude-sonnet-5" });
const prompt = ChatPromptTemplate.fromMessages([["system", "Be terse."]]);
const chain = prompt.pipe(model);
await chain.invoke({ input: "hello" });
