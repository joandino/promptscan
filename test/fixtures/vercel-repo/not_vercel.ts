// `generateText` here is from an unrelated package, not `ai` — must NOT be flagged.
import { generateText } from "some-other-text-library";

const result = generateText({
  model: "whatever",
  prompt: "This should not be detected as an LLM call.",
});
