import openai
client = openai.OpenAI()

# self-identifying long chains (detected on shape)
a = client.chat.completions.stream(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
b = client.chat.completions.parse(model="gpt-4o", messages=[{"role": "user", "content": "parse me"}], response_format=dict)

# short responses chains (gated on openai import -> here bound, so high)
c = client.responses.stream(model="gpt-4.1", input="stream this")
