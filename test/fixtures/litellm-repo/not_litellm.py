# `completion` here comes from an unrelated library, with no litellm import.
# It must NOT be flagged — the gate is the litellm import, not the method name.
from mylib import completion

result = completion(
    model="gpt-4o",
    messages=[{"role": "user", "content": "This should not be detected as an LLM call."}],
)
