import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "Estimate the total cost of running this prompt at scale."}])
