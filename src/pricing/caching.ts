import type { Provider } from '../report/types.js';
import { resolvePricing } from './table.js';

/**
 * Prompt-caching pricing multipliers, relative to the base input price.
 * Source: platform.claude.com/docs/en/about-claude/pricing#prompt-caching
 * (verified 2026-07-23). These DRIFT — re-verify with the pricing table.
 */
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2;
export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Minimum cacheable prompt length, in tokens, per model. A `cache_control`
 * breakpoint on a prefix SHORTER than this is silently ignored by the API — no
 * cache is created and no discount applies. This is why PromptScan never
 * recommends caching a block below the threshold for its model.
 *
 * Source: platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
 * (verified 2026-07-23). Keyed by the canonical pricing-table id.
 */
const MIN_CACHEABLE: Record<string, number> = {
  'claude-fable-5': 512,
  'claude-mythos-5': 512,
  'claude-opus-4-8': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-opus-4-1': 1024,
  'claude-opus-4-0': 1024,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-sonnet-4-5': 1024,
  'claude-sonnet-4-0': 1024,
  'claude-haiku-4-5': 4096,
  'claude-3-haiku': 2048,
};

/**
 * The largest minimum in the table. Used for an Anthropic model we can't place,
 * so an unknown model under-reports opportunities rather than recommending a
 * breakpoint the API would ignore. Wrong advice is worse than no advice.
 */
export const CONSERVATIVE_MIN_CACHEABLE = 4096;

/**
 * Minimum cacheable prompt length for a model, or null when caching doesn't
 * apply (non-Anthropic providers, or no resolved model).
 *
 * OpenAI caches automatically with no `cache_control` marker and no code change,
 * so there is no opportunity to surface and nothing to detect — it is
 * deliberately out of scope here rather than guessed at.
 */
export function minCacheableTokens(provider: Provider, model: string | null): number | null {
  if (provider !== 'anthropic') return null;
  if (!model) return null;
  const entry = resolvePricing(provider, model);
  if (!entry) return CONSERVATIVE_MIN_CACHEABLE;
  return MIN_CACHEABLE[entry.id] ?? CONSERVATIVE_MIN_CACHEABLE;
}
