from openai import OpenAI

client = OpenAI()


def run():
    return client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "system", "content": "You are a vendored assistant that should be skippable."}],
    )
