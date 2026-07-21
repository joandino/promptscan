import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

const llm = new ChatOpenAI({ model: "gpt-4o" });

export async function ask(q: string) {
  return llm.invoke([
    new SystemMessage("You are a meticulous assistant."),
    new HumanMessage("What is the capital of France?"),
  ]);
}
