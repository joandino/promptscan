import openai

# BASE_PROMPT is re-exported by prompts.py from base.py — a two-hop resolution.
from prompts import BASE_PROMPT

client = openai.OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": BASE_PROMPT},
    ],
)
