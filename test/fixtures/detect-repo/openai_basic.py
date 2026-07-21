import openai

client = openai.OpenAI()

def ask(q):
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": q}],
    )
