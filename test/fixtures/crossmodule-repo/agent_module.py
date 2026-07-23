import openai
import prompts

client = openai.OpenAI()

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": prompts.SYSTEM_PROMPT},
    ],
)
