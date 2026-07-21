import type { Provider } from '../report/types.js';

/**
 * Bundled, versioned pricing. Prices are USD per 1,000,000 tokens and DRIFT —
 * update this table and bump PRICING_VERSION / PRICING_AS_OF when they change.
 * PromptScan only bills INPUT cost (output tokens aren't statically knowable),
 * but output prices are recorded here for completeness.
 *
 * Anthropic prices: platform.claude.com pricing reference (as of 2026-06).
 * OpenAI prices: publicly listed rates; verify before relying on them.
 */
export const PRICING_VERSION = '2026.07';
export const PRICING_AS_OF = '2026-07-21';

export interface PricingEntry {
  /** Canonical model id this entry prices. */
  id: string;
  provider: Provider;
  inputPerMTok: number;
  outputPerMTok: number;
  note?: string;
}

/** Exact-id prices. Matching falls back to prefix rules below. */
const TABLE: PricingEntry[] = [
  // ---- Anthropic (authoritative, per platform.claude.com) ----
  { id: 'claude-fable-5', provider: 'anthropic', inputPerMTok: 10, outputPerMTok: 50 },
  { id: 'claude-mythos-5', provider: 'anthropic', inputPerMTok: 10, outputPerMTok: 50 },
  { id: 'claude-opus-4-8', provider: 'anthropic', inputPerMTok: 5, outputPerMTok: 25 },
  { id: 'claude-opus-4-7', provider: 'anthropic', inputPerMTok: 5, outputPerMTok: 25 },
  { id: 'claude-opus-4-6', provider: 'anthropic', inputPerMTok: 5, outputPerMTok: 25 },
  { id: 'claude-opus-4-5', provider: 'anthropic', inputPerMTok: 5, outputPerMTok: 25 },
  { id: 'claude-opus-4-1', provider: 'anthropic', inputPerMTok: 15, outputPerMTok: 75 },
  { id: 'claude-opus-4-0', provider: 'anthropic', inputPerMTok: 15, outputPerMTok: 75 },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    inputPerMTok: 3,
    outputPerMTok: 15,
    note: 'intro $2/$10 per MTok through 2026-08-31',
  },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', inputPerMTok: 3, outputPerMTok: 15 },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', inputPerMTok: 3, outputPerMTok: 15 },
  { id: 'claude-sonnet-4-0', provider: 'anthropic', inputPerMTok: 3, outputPerMTok: 15 },
  { id: 'claude-haiku-4-5', provider: 'anthropic', inputPerMTok: 1, outputPerMTok: 5 },
  { id: 'claude-3-haiku', provider: 'anthropic', inputPerMTok: 0.25, outputPerMTok: 1.25 },

  // ---- OpenAI (publicly listed; verify before relying) ----
  { id: 'gpt-4o', provider: 'openai', inputPerMTok: 2.5, outputPerMTok: 10 },
  { id: 'gpt-4o-mini', provider: 'openai', inputPerMTok: 0.15, outputPerMTok: 0.6 },
  { id: 'gpt-4.1', provider: 'openai', inputPerMTok: 2, outputPerMTok: 8 },
  { id: 'gpt-4.1-mini', provider: 'openai', inputPerMTok: 0.4, outputPerMTok: 1.6 },
  { id: 'gpt-4.1-nano', provider: 'openai', inputPerMTok: 0.1, outputPerMTok: 0.4 },
  { id: 'gpt-4-turbo', provider: 'openai', inputPerMTok: 10, outputPerMTok: 30 },
  { id: 'gpt-4', provider: 'openai', inputPerMTok: 30, outputPerMTok: 60 },
  { id: 'gpt-3.5-turbo', provider: 'openai', inputPerMTok: 0.5, outputPerMTok: 1.5 },
  { id: 'o1', provider: 'openai', inputPerMTok: 15, outputPerMTok: 60 },
  { id: 'o1-mini', provider: 'openai', inputPerMTok: 1.1, outputPerMTok: 4.4 },
  { id: 'o3', provider: 'openai', inputPerMTok: 2, outputPerMTok: 8 },
  { id: 'o3-mini', provider: 'openai', inputPerMTok: 1.1, outputPerMTok: 4.4 },
  { id: 'o4-mini', provider: 'openai', inputPerMTok: 1.1, outputPerMTok: 4.4 },
];

const BY_ID = new Map(TABLE.map((e) => [e.id, e]));

/**
 * Prefix rules for models that carry suffixes (dates, `-latest`, etc.). Ordered
 * most-specific first so `gpt-4o-mini` wins over `gpt-4o`, and `gpt-4-turbo`
 * over `gpt-4`.
 */
const PREFIX_RULES: Array<{ prefix: string; id: string }> = [
  { prefix: 'gpt-4o-mini', id: 'gpt-4o-mini' },
  { prefix: 'gpt-4o', id: 'gpt-4o' },
  { prefix: 'gpt-4.1-nano', id: 'gpt-4.1-nano' },
  { prefix: 'gpt-4.1-mini', id: 'gpt-4.1-mini' },
  { prefix: 'gpt-4.1', id: 'gpt-4.1' },
  { prefix: 'gpt-4-turbo', id: 'gpt-4-turbo' },
  { prefix: 'gpt-4-', id: 'gpt-4' },
  { prefix: 'gpt-4', id: 'gpt-4' },
  { prefix: 'gpt-3.5', id: 'gpt-3.5-turbo' },
  { prefix: 'o1-mini', id: 'o1-mini' },
  { prefix: 'o1', id: 'o1' },
  { prefix: 'o3-mini', id: 'o3-mini' },
  { prefix: 'o3', id: 'o3' },
  { prefix: 'o4-mini', id: 'o4-mini' },
  // Anthropic dated/retired snapshots → nearest family.
  { prefix: 'claude-3-5-sonnet', id: 'claude-sonnet-4-5' },
  { prefix: 'claude-3-5-haiku', id: 'claude-haiku-4-5' },
];

/** Look up pricing for a provider/model, or null if the model isn't priced. */
export function resolvePricing(provider: Provider, model: string | null): PricingEntry | null {
  if (!model) return null;
  const exact = BY_ID.get(model);
  if (exact && exact.provider === provider) return exact;

  const m = model.toLowerCase();
  for (const rule of PREFIX_RULES) {
    if (m.startsWith(rule.prefix)) {
      const entry = BY_ID.get(rule.id);
      if (entry && entry.provider === provider) return entry;
    }
  }
  return null;
}
