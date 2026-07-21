import openai
client = openai.OpenAI()

def build(q):
    return [{"role": "user", "content": q}]

resp = client.chat.completions.create(model="gpt-4o", messages=build("hi"))
