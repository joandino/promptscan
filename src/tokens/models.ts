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
 * Which tokenizer family an Anthropic model uses. Claude Opus 4.7 introduced a
 * new tokenizer that produces materially more tokens for the same text; Opus 4.6
 * and earlier, and the Sonnet 4.x / Haiku lines, use the previous one.
 */
export type AnthropicTokenizer = 'previous' | 'newer';

/**
 * Models on the newer tokenizer: Opus 4.7 and later Opus, Sonnet 5, Fable 5,
 * and Mythos. Matched on prefixes so dated snapshots resolve too.
 * Source: platform.claude.com token-counting docs (verified 2026-07-23).
 */
const NEWER_TOKENIZER = [
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-mythos',
];

/**
 * Correction applied to a cl100k_base content count for each Anthropic
 * tokenizer family, calibrated END-TO-END against /v1/messages/count_tokens on
 * 2026-07-23: nine full prompts per family (system + 1..5 messages, spanning
 * instructions, few-shot, JSON schemas, code, policy prose, and dialogue),
 * comparing PromptScan's whole estimate — content count plus the structural
 * overhead model below — against the real count.
 *
 *   previous tokenizer  ideal factor 1.01  (range 0.93-1.12)  → no correction
 *   newer tokenizer     ideal factor 1.43  (range 1.33-1.59)  → 1.43
 *
 * Calibrating end-to-end rather than on raw token ratios matters. Measured on
 * content alone the previous-tokenizer proxy looks 13% low, but PromptScan's
 * per-message overhead (borrowed from OpenAI) runs slightly high for Anthropic
 * and offsets almost exactly. Correcting the content in isolation would have
 * made those estimates ~7% worse, not better. The newer tokenizer's gap is far
 * too large for that to absorb, so it gets a real correction.
 *
 * Residual after correction is roughly ±10%, scattering both directions rather
 * than always low. Re-measure when Anthropic ships a new tokenizer.
 */
const CALIBRATION: Record<AnthropicTokenizer, number> = {
  previous: 1,
  newer: 1.43,
};

/**
 * Models known to use the previous tokenizer: the Claude 3 line, Sonnet 4.x,
 * Opus 4.0 through 4.6, and the Haiku line. Listed explicitly so a legacy model
 * is never swept into the newer family by the fallback below.
 */
const PREVIOUS_TOKENIZER = [
  'claude-3',
  'claude-sonnet-4-',
  'claude-opus-4-0',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-haiku-',
];

/**
 * Tokenizer family for an Anthropic model.
 *
 * Both families are matched explicitly; anything in neither list falls back to
 * 'newer', because an unrecognized string is usually a model released after
 * this table was written and every Claude model since Opus 4.7 uses the newer
 * tokenizer. That fallback also errs toward over-reporting cost rather than
 * under-reporting it, which is the safer direction for a budgeting tool.
 */
export function anthropicTokenizer(model: string | null): AnthropicTokenizer {
  if (!model) return 'newer';
  const m = model.toLowerCase();
  if (NEWER_TOKENIZER.some((p) => m.startsWith(p))) return 'newer';
  if (PREVIOUS_TOKENIZER.some((p) => m.startsWith(p))) return 'previous';
  return 'newer';
}

/** Multiplier taking a cl100k_base count to an estimate of the real count. */
export function anthropicCalibration(model: string | null): number {
  return CALIBRATION[anthropicTokenizer(model)];
}

/**
 * Resolve the tokenizer encoding for a provider/model.
 *
 * Anthropic has no public tokenizer (`@anthropic-ai/tokenizer` on npm is the
 * Claude 1/2 vocabulary, last released in 2023), so we count with cl100k_base
 * and apply the calibration above. Counts stay approximate and labeled.
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
export function encodingLabel(provider: Provider, encoding: EncodingName, model: string | null = null): string {
  if (provider === 'anthropic') {
    const family = anthropicTokenizer(model);
    const factor = CALIBRATION[family];
    return factor === 1
      ? `${encoding} (anthropic ${family}-tokenizer proxy)`
      : `${encoding} x${factor.toFixed(2)} (anthropic ${family}-tokenizer calibration)`;
  }
  if (provider === 'other') return `${encoding} (litellm proxy)`;
  return encoding;
}
