import openai
client = openai.OpenAI()
client.chat.completions.create(model="gpt-4o", messages=[{"role": "system", "content": "You draft friendly release notes from a list of merged pull requests for the changelog."}])
