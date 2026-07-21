import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "You summarize long incident reports into a concise three sentence executive briefing for leadership."}])
