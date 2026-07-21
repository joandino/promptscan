import openai
client = openai.OpenAI()
client.chat.completions.create(model="some-unlisted-model-x1", messages=[{"role": "user", "content": "Estimate the total cost of running this prompt at scale."}])
