import openai
client = openai.OpenAI()

P = "first"
P = "second"
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": P}],
)
