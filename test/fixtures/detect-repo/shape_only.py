# no imports at all; the chain alone is self-identifying -> high (shape)
result = handle.chat.completions.create(model="gpt-4o-mini", messages=[])
