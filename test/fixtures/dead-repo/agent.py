from prompts import USED_PROMPT
import openai

client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": USED_PROMPT}])
