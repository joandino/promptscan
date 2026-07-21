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

/** Render detected call sites as a plain (color-free) terminal table. */
export function renderCallSiteTable(callSites: CallSite[]): string {
  const table = new Table({
    head: ['Location', 'Provider', 'Model', 'Confidence'],
    style: { head: [], border: [] },
  });

  for (const site of callSites) {
    table.push([
      `${site.file}:${site.line}`,
      site.provider,
      modelCell(site),
      confidenceCell(site),
    ]);
  }

  return table.toString();
}
