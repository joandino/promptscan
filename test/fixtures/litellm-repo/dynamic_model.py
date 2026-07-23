import litellm

from config import pick_model


def run(question: str):
    # Model chosen at runtime — provider can't be known statically → 'other'.
    return litellm.completion(
        model=pick_model(),
        messages=[
            {"role": "user", "content": "What is the capital of France, and why does it matter?"},
        ],
    )
