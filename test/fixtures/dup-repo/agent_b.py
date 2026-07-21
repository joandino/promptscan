import openai
client = openai.OpenAI()
# exact duplicate of agent_a's system prompt (inline literal vs constant)
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "You are a meticulous senior support engineer at Acme Corp. Answer the customer clearly, cite the exact steps needed to reproduce the issue, and never speculate about the root cause without concrete evidence from the logs."}])
