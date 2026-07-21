import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "Translate the following text into formal French preserving the original tone and register."}])
