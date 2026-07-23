import type { Provider } from '../report/types.js';

export type EncodingName = 'o200k_base' | 'cl100k_base';

export interface EncodingChoice {
  encoding: EncodingName;
  /** True when a model pattern matched; false when we fell back to a default. */
  matched: boolean;
}

/** Newer OpenAI models use o200k_base; the GPT-4/3.5 generation uses cl100k_base. */
function encodingForOpenAIModel(model: string): EncodingChoice {
  const m = model.toLowerCase();
  // Checked before the gpt-4 branch so gpt-4o / gpt-4.1 don't fall through to cl100k.
  if (/^(gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|o1|o3|o4|gpt-oss)/.test(m)) {
    return { encoding: 'o200k_base', matched: true };
  }
  if (/^(gpt-4|gpt-3\.5|text-embedding-3|text-embedding-ada)/.test(m)) {
    return { encoding: 'cl100k_base', matched: true };
  }
  // Unknown/newer model: assume the current default encoding, flagged as a guess.
  return { encoding: 'o200k_base', matched: false };
}

/**
 * Resolve the tokenizer encoding for a provider/model.
 *
 * Anthropic has no public tokenizer, so we use cl100k_base as a proxy — counts
 * are approximate and must be labeled as such by callers.
 */
export function resolveEncoding(provider: Provider, model: string | null): EncodingChoice {
  if (provider === 'anthropic') {
    // matched:true — the proxy is intentional, not a fallback guess.
    return { encoding: 'cl100k_base', matched: true };
  }
  if (provider === 'other') {
    // A litellm backend we don't natively tokenize — cl100k as a rough proxy,
    // matched:false so it surfaces as approximate.
    return { encoding: 'cl100k_base', matched: false };
  }
  return model ? encodingForOpenAIModel(model) : { encoding: 'o200k_base', matched: false };
}

/** Human-readable label for the encoding used, noting proxy tokenizers. */
export function encodingLabel(provider: Provider, encoding: EncodingName): string {
  if (provider === 'anthropic') return `${encoding} (anthropic proxy)`;
  if (provider === 'other') return `${encoding} (litellm proxy)`;
  return encoding;
}
