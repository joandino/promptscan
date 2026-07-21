import anthropic

client = anthropic.Anthropic()
SYSTEM = "You are a helpful assistant."

resp = client.messages.create(
    model="claude-sonnet-5",
    system=SYSTEM,
    max_tokens=1024,
    messages=[{"role": "user", "content": "hello"}],
)
