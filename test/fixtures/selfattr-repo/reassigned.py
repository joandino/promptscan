import openai


class Flaky:
    def __init__(self, mode):
        self.client = openai.OpenAI()
        self.system = "You are the first assistant configuration."
        if mode:
            # Reassigned → must stay honestly unresolved.
            self.system = "You are the second assistant configuration."

    def run(self):
        return self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": self.system}],
        )
