import type {
  CallSite,
  CostEstimate,
  MonthlyProjection,
  MonthlyProjectionSite,
  Provider,
} from '../report/types.js';
import { resolvePricing } from './table.js';

/** Estimate the input cost of a single call from its token count and model. */
export function estimateCost(
  provider: Provider,
  model: string | null,
  inputTokens: number,
): CostEstimate {
  const entry = resolvePricing(provider, model);
  if (!entry) {
    return { inputCostUsd: null, pricePerMTok: null, pricedAs: null };
  }
  return {
    inputCostUsd: (inputTokens / 1_000_000) * entry.inputPerMTok,
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
