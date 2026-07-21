import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "You translate technical documentation into clear plain English for new engineers on the team."}])
