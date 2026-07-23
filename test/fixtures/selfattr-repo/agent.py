import openai

SUPPORT_PROMPT = "You are a meticulous senior support engineer at Acme Co."


class SupportAgent:
    def __init__(self):
        self.client = openai.OpenAI()
        self.model = "gpt-4o"
        self.system = SUPPORT_PROMPT

    def reply(self, ticket: str):
        return self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self.system},
                {"role": "user", "content": ticket},
            ],
        )
