import openai
client = openai.OpenAI()

MSGS = [
    {"role": "system", "content": "S"},
    {"role": "user", "content": "U"},
]
resp = client.chat.completions.create(model="gpt-4o", messages=MSGS)
