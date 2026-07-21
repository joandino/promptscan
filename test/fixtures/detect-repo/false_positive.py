# No openai/anthropic import and no client binding.
# These short chains must NOT be reported.
queue.messages.create(model="internal-thing")
db.responses.create(payload={})
