import openai
client = openai.OpenAI()

out = client.responses.create(
    model="gpt-4.1",
    instructions="You are concise.",
    input="Summarize the plan.",
)
