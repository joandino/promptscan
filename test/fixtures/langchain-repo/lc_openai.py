from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

llm = ChatOpenAI(model="gpt-4o", temperature=0)

def ask(q):
    return llm.invoke([
        SystemMessage(content="You are a meticulous assistant."),
        HumanMessage(content="What is the capital of France?"),
    ])
