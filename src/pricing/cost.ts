import type {
  CallSite,
  CostEstimate,
  MonthlyProjection,
  MonthlyProjectionSite,
  Provider,
} from '../report/types.js';
import { resolvePricing } from './table.js';
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_5M_MULTIPLIER } from './caching.js';

/**
 * Estimate the input cost of a single call from its token count and model.
 *
 * `cachedTokens` is the prefix covered by a `cache_control` breakpoint. Billing
 * it at the base rate would overstate the cost of a caching call site by up to
 * 10x, so the headline `inputCostUsd` is the STEADY-STATE cost (cached prefix at
 * the 0.1x read rate) — a prefix is written once and read on every later call.
 * The one-time write premium is reported separately rather than amortized into a
 * per-call number we can't ground without a call-count assumption.
 */
export function estimateCost(
  provider: Provider,
  model: string | null,
  inputTokens: number,
  cachedTokens = 0,
): CostEstimate {
  const entry = resolvePricing(provider, model);
  if (!entry) {
    return {
      inputCostUsd: null,
      uncachedInputCostUsd: null,
      cacheWriteCostUsd: null,
      pricePerMTok: null,
      pricedAs: null,
    };
  }

  const perToken = entry.inputPerMTok / 1_000_000;
  const uncachedInputCostUsd = inputTokens * perToken;

  // Clamp: a cached prefix can never exceed the tokens actually counted.
  const cached = Math.min(Math.max(cachedTokens, 0), inputTokens);
  if (cached === 0) {
    return {
      inputCostUsd: uncachedInputCostUsd,
      uncachedInputCostUsd,
      cacheWriteCostUsd: null,
      pricePerMTok: entry.inputPerMTok,
      pricedAs: entry.id,
    };
  }

  const rest = inputTokens - cached;
  return {
    inputCostUsd: cached * perToken * CACHE_READ_MULTIPLIER + rest * perToken,
    uncachedInputCostUsd,
    cacheWriteCostUsd: cached * perToken * CACHE_WRITE_5M_MULTIPLIER + rest * perToken,
    pricePerMTok: entry.inputPerMTok,
    pricedAs: entry.id,
  };
}

/** Call-volume estimate: a default per-site rate plus per-site overrides. */
export interface VolumeConfig {
  /** Calls/month applied to every call site without an override. */
  default?: number;
  /** Per-site overrides keyed by "file:line". */
  sites?: Record<string, number>;
}

function callsForSite(site: CallSite, volume: VolumeConfig): number {
  const key = `${site.file}:${site.line}`;
  return volume.sites?.[key] ?? volume.default ?? 0;
}

/**
 * Project monthly input cost and tokens from per-call estimates and a volume
 * config. Only call sites with countable prompts and priced models contribute
 * to the cost total; unpriced ones are counted separately, never guessed.
 */
export function projectMonthly(callSites: CallSite[], volume: VolumeConfig): MonthlyProjection {
  const sites: MonthlyProjectionSite[] = [];
  let monthlyInputTokens = 0;
  let monthlyInputCostUsd = 0;
  let unpriced = 0;

  for (const site of callSites) {
    if (site.prompt.status === 'unresolved') continue;
    const callsPerMonth = callsForSite(site, volume);
    if (callsPerMonth <= 0) continue;

    monthlyInputTokens += site.tokens.inputTokens * callsPerMonth;

    let monthlyCost: number | null = null;
    if (site.cost.inputCostUsd !== null) {
      monthlyCost = site.cost.inputCostUsd * callsPerMonth;
      monthlyInputCostUsd += monthlyCost;
    } else {
      unpriced++;
    }

    sites.push({
      file: site.file,
      line: site.line,
      callsPerMonth,
      monthlyInputCostUsd: monthlyCost,
    });
  }

  sites.sort((a, b) => (b.monthlyInputCostUsd ?? 0) - (a.monthlyInputCostUsd ?? 0));
  return { monthlyInputTokens, monthlyInputCostUsd, unpriced, sites };
}
