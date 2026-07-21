import openai

client = openai.OpenAI()
ver = "4o"
r = client.chat.completions.create(model=f"gpt-{ver}", messages=[])
