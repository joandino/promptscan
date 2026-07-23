import litellm

response = litellm.completion(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a meticulous senior support engineer."},
        {"role": "user", "content": "Summarize this ticket for the on-call rotation."},
    ],
)
