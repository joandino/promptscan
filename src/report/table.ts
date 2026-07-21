import Table from 'cli-table3';
import type { CallSite } from './types.js';

function modelCell(site: CallSite): string {
  if (site.modelResolved && site.model !== null) return site.model;
  if (site.modelHint) return `‹${site.modelHint}› (unresolved)`;
  return '‹unresolved›';
}

function confidenceCell(site: CallSite): string {
  // Surface *why* a medium call site was included, so users can judge it.
  return site.confidence === 'high' ? 'high' : `medium (${site.basis})`;
}

/**
 * Input-token cell. Encodes prompt status via markers:
 *   —   unresolved (no countable content)
 *   +   partial (static content only — a floor)
 *   ~   approximate (proxy/fallback tokenizer)
 */
function tokenCell(site: CallSite): string {
  if (site.prompt.status === 'unresolved') return '—';
  const prefix = site.tokens.approximate ? '~' : '';
  const suffix = site.prompt.status === 'partial' ? '+' : '';
  return `${prefix}${site.tokens.inputTokens.toLocaleString('en-US')}${suffix}`;
}

/** Format a USD amount with enough precision for sub-cent per-call costs. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function costCell(site: CallSite): string {
  if (site.prompt.status === 'unresolved') return '—';
  if (site.cost.inputCostUsd === null) return 'unpriced';
  const prefix = site.tokens.approximate ? '~' : '';
  return `${prefix}${formatUsd(site.cost.inputCostUsd)}`;
}

/** Whether the table needs its marker legend (any non-exact token cell). */
function needsLegend(callSites: CallSite[]): boolean {
  return callSites.some((s) => s.prompt.status !== 'resolved' || s.tokens.approximate);
}

/** Render detected call sites as a plain (color-free) terminal table. */
export function renderCallSiteTable(callSites: CallSite[]): string {
  const table = new Table({
    head: ['Location', 'Provider', 'Model', 'Input tok', 'Input $', 'Confidence'],
    style: { head: [], border: [] },
    colAligns: ['left', 'left', 'left', 'right', 'right', 'left'],
  });

  for (const site of callSites) {
    table.push([
      `${site.file}:${site.line}`,
      site.provider,
      modelCell(site),
      tokenCell(site),
      costCell(site),
      confidenceCell(site),
    ]);
  }

  let out = table.toString();
  if (needsLegend(callSites)) {
    out += '\n  ~ approximate (proxy/fallback tokenizer)   + partial (static floor)   — unresolved';
  }
  return out;
}
