import openai
client = openai.OpenAI()

SYSTEM_PROMPT = "You are an expert Python reviewer."

resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "system", "content": SYSTEM_PROMPT}],
)
