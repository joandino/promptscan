import openai
client = openai.OpenAI()
# near-duplicate: "senior" -> "junior" (copy-paste drift)
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "You are a meticulous junior support engineer at Acme Corp. Answer the customer clearly, cite the exact steps needed to reproduce the issue, and never speculate about the root cause without concrete evidence from the logs."}])
