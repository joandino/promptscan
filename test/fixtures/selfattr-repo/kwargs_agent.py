import openai

client = openai.OpenAI()

params = {
    "model": "gpt-4o-mini",
    "messages": [
        {"role": "system", "content": "You classify incoming tickets by urgency."},
    ],
}

resp = client.chat.completions.create(**params)
