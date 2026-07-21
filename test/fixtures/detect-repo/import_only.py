import anthropic

# receiver not bound to a constructor here; import corroborates -> medium
def run(agent):
    return agent.messages.create(model="claude-3-5-sonnet", messages=[])
