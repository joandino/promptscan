import anthropic
from pathlib import Path
client = anthropic.Anthropic()

resp = client.messages.create(
    model="claude-sonnet-5",
    system=open("prompts/system.txt").read(),
    messages=[{"role": "user", "content": Path("prompts/agent.md").read_text()}],
)
