# Twilio also has client.messages.stream() (lists messages) — must NOT be flagged.
from twilio.rest import Client
client = Client("sid", "tok")
for m in client.messages.stream():
    print(m.body)
