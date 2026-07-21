import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[
    {"role": "system", "content": "You are a meticulous senior support engineer at Acme who always cites reproduction steps."},
    {"role": "user", "content": "question number 3 about billing edge cases"},
])
