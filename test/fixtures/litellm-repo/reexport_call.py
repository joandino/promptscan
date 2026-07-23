# The aider pattern: litellm is lazily re-exported and imported by name.
from app.llm import litellm

completion = litellm.completion(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You review pull requests and flag risky changes."},
    ],
)
