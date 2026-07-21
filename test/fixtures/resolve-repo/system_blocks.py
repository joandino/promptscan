import anthropic
client = anthropic.Anthropic()

resp = client.messages.create(
    model="claude-sonnet-5",
    system=[{"type": "text", "text": "You are helpful."}],
    messages=[{"role": "user", "content": "hi"}],
)
