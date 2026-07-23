import litellm


async def summarize(text: str):
    return await litellm.acompletion(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You compress meeting notes into three bullet points."},
        ],
    )
