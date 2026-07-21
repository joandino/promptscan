import openai
client = openai.OpenAI()

HEADER = "System: "

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "system", "content": HEADER + "be terse." "  Always."}],
)
