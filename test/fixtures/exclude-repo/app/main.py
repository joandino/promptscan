from openai import OpenAI

client = OpenAI()


def run():
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "system", "content": "You are the application assistant for the main app."}],
    )
