__all__ = ["EXPORTED_PROMPT"]

USED_PROMPT = "You are a helpful assistant that answers questions about billing."
DEAD_PROMPT = "You are a legacy summarizer that nobody calls anymore, sadly unused."
EXPORTED_PROMPT = "You are the public API prompt that other packages import and use."
DYNAMIC_PROMPT = "You are accessed dynamically through getattr so keep me around please."
VERSION = "1.2.3"

def build():
    return getattr(__import__("prompts"), "DYNAMIC_PROMPT")
