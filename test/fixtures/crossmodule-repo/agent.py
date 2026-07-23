import openai

from prompts import SYSTEM_PROMPT

client = openai.OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": "Please help with my billing issue."},
    ],
)
