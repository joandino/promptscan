from litellm import completion

# A provider PromptScan does not natively tokenize/price → reported as 'other'.
out = completion(
    model="gemini/gemini-1.5-pro",
    messages=[
        {"role": "user", "content": "Explain the difference between a mutex and a semaphore."},
    ],
)
