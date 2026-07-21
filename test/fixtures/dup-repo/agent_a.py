import openai
client = openai.OpenAI()
SYS = "You are a meticulous senior support engineer at Acme Corp. Answer the customer clearly, cite the exact steps needed to reproduce the issue, and never speculate about the root cause without concrete evidence from the logs."
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": SYS}])
