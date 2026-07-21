# Real-world reason `.messages.create` is gated on an anthropic import/binding:
# `client.messages.create(...)` is ALSO Twilio's SMS API. Detecting this as an
# Anthropic LLM call would be a false positive. It must NOT be detected.
from twilio.rest import Client

client = Client("AC_sid", "auth_token")
client.messages.create(to="+15551234567", from_="+15557654321", body="hello")
