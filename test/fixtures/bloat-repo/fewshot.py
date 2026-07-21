import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[
    {"role": "system", "content": "Classify the sentiment of each review as positive or negative clearly."},
    {"role": "user", "content": "The product was amazing and shipping was fast."},
    {"role": "assistant", "content": "positive"},
    {"role": "user", "content": "It broke after one day of light use."},
    {"role": "assistant", "content": "negative"},
    {"role": "user", "content": "Absolutely love it, would buy again for sure."},
])
