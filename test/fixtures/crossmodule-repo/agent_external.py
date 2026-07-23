import openai

# This module is not part of the scan (a third-party package) — must stay unresolved.
from thirdparty_llm_kit import EXTERNAL_PROMPT

client = openai.OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": EXTERNAL_PROMPT},
    ],
)
