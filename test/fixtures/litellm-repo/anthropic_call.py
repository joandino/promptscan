from litellm import completion

reply = completion(
    model="claude-3-5-sonnet-20241022",
    messages=[
        {"role": "user", "content": "Draft a friendly reminder about the upcoming maintenance window."},
    ],
)
