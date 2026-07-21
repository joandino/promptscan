from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate

model = ChatAnthropic(model="claude-sonnet-5")
prompt = ChatPromptTemplate.from_messages([("system", "Be terse.")])
chain = prompt | model

result = chain.invoke({"input": "hello"})
