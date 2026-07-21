import openai as oai

c = oai.OpenAI()
out = c.responses.create(model="gpt-4.1", input="hi")
