import type { CallSite, ScanReport } from '../report/types.js';
import { normalizedPrompt, wordSet, jaccard } from '../analyze/text.js';

export interface DiffTotalsSide {
  inputTokens: number;
  inputCostUsd: number;
  callSites: number;
}

export interface DiffTotals {
  base: DiffTotalsSide;
  head: DiffTotalsSide;
  tokenDelta: number;
  /** Percent change in input tokens, or null when the base is zero. */
  tokenPct: number | null;
  costDelta: number;
  costPct: number | null;
}

export interface DiffSite {
  file: string;
  line: number;
  provider: string;
  method: string;
  inputTokens: number;
  inputCostUsd: number | null;
  /** Best near-duplicate of a new prompt within the head scan, if any. */
  nearDup: { file: string; line: number; similarity: number } | null;
}

export interface DiffReport {
  totals: DiffTotals;
  /** Resolved prompts present in head whose text is absent from base. */
  newPrompts: DiffSite[];
  /** Resolved prompts present in base whose text is absent from head. */
  removedPrompts: DiffSite[];
  meta: { version: string; pricingVersion: string; pricingAsOf: string };
}

export interface DiffOptions {
  /** Near-duplicate threshold for the "new prompt looks like X" hint. */
  threshold?: number;
}

function pct(delta: number, base: number): number | null {
  return base === 0 ? null : (delta / base) * 100;
}

function toSite(site: CallSite, nearDup: DiffSite['nearDup'] = null): DiffSite {
  return {
    file: site.file,
    line: site.line,
    provider: site.provider,
    method: site.method,
    inputTokens: site.tokens.inputTokens,
    inputCostUsd: site.cost.inputCostUsd,
    nearDup,
  };
}

/** Resolved call sites with non-empty prompt text, keyed by normalized text. */
function resolvedByText(report: ScanReport): Map<string, CallSite[]> {
  const map = new Map<string, CallSite[]>();
  for (const site of report.callSites) {
    if (site.prompt.status !== 'resolved') continue;
    const text = normalizedPrompt(site);
    if (!text) continue;
    const bucket = map.get(text);
    if (bucket) bucket.push(site);
    else map.set(text, [site]);
  }
  return map;
}

/** Find the closest other head prompt to a new prompt, above the threshold. */
function bestNearDup(
  site: CallSite,
  headSites: CallSite[],
  threshold: number,
): DiffSite['nearDup'] {
  const words = wordSet(normalizedPrompt(site));
  let best: DiffSite['nearDup'] = null;
  for (const other of headSites) {
    if (other === site) continue;
    const sim = jaccard(words, wordSet(normalizedPrompt(other)));
    if (sim >= threshold && sim < 1 && (!best || sim > best.similarity)) {
      best = { file: other.file, line: other.line, similarity: sim };
    }
  }
  return best;
}

/** Compute the delta between a base and head scan of the same target. */
export function computeDiff(base: ScanReport, head: ScanReport, opts: DiffOptions = {}): DiffReport {
  const threshold = opts.threshold ?? 0.85;

  const totals: DiffTotals = {
    base: {
      inputTokens: base.stats.inputTokens,
      inputCostUsd: base.stats.inputCostUsd,
      callSites: base.stats.callSites,
    },
    head: {
      inputTokens: head.stats.inputTokens,
      inputCostUsd: head.stats.inputCostUsd,
      callSites: head.stats.callSites,
    },
    tokenDelta: head.stats.inputTokens - base.stats.inputTokens,
    tokenPct: pct(head.stats.inputTokens - base.stats.inputTokens, base.stats.inputTokens),
    costDelta: head.stats.inputCostUsd - base.stats.inputCostUsd,
    costPct: pct(head.stats.inputCostUsd - base.stats.inputCostUsd, base.stats.inputCostUsd),
  };

  const baseText = resolvedByText(base);
  const headText = resolvedByText(head);
  const headSitesResolved = head.callSites.filter((s) => s.prompt.status === 'resolved');

  const newPrompts: DiffSite[] = [];
  for (const [text, sites] of headText) {
    if (baseText.has(text)) continue;
    for (const site of sites) {
      newPrompts.push(toSite(site, bestNearDup(site, headSitesResolved, threshold)));
    }
  }
  newPrompts.sort((a, b) => b.inputTokens - a.inputTokens);

  const removedPrompts: DiffSite[] = [];
  for (const [text, sites] of baseText) {
    if (headText.has(text)) continue;
    for (const site of sites) removedPrompts.push(toSite(site));
  }
  removedPrompts.sort((a, b) => b.inputTokens - a.inputTokens);

  return {
    totals,
    newPrompts,
    removedPrompts,
    meta: {
      version: head.meta.version,
      pricingVersion: head.meta.pricingVersion,
      pricingAsOf: head.meta.pricingAsOf,
    },
  };
}

/**
 * Whether the head exceeds the base by more than `failOnIncreasePct` on the
 * chosen metric. Returns false when there's no base to compare against.
 */
export function exceedsIncrease(
  report: DiffReport,
  metric: 'tokens' | 'cost',
  failOnIncreasePct: number,
): boolean {
  const p = metric === 'tokens' ? report.totals.tokenPct : report.totals.costPct;
  return p !== null && p > failOnIncreasePct;
}
