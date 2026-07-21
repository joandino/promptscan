from anthropic import AsyncAnthropic

MODEL = "claude-haiku-4-5"
client = AsyncAnthropic()

async def go():
    return await client.messages.create(model=MODEL, max_tokens=10, messages=[])
