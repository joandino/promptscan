import type { DiffReport, DiffSite } from './diff.js';
import { formatUsd } from '../report/table.js';

function fmtPct(p: number | null): string {
  if (p === null) return 'n/a';
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function fmtSignedTokens(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('en-US')}`;
}

function fmtSignedUsd(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${formatUsd(Math.abs(n))}`;
}

function siteLine(s: DiffSite): string {
  const cost = s.inputCostUsd === null ? 'unpriced' : formatUsd(s.inputCostUsd);
  const near = s.nearDup
    ? ` · near-duplicate of ${s.nearDup.file}:${s.nearDup.line} (${s.nearDup.similarity.toFixed(2)})`
    : '';
  return `${s.file}:${s.line} — +${s.inputTokens.toLocaleString('en-US')} tokens (${cost})${near}`;
}

/** Human-readable terminal diff. */
export function renderDiffTable(diff: DiffReport): string {
  const { totals } = diff;
  const lines: string[] = [];
  lines.push('');
  lines.push('PromptScan diff');
  lines.push('');
  lines.push(
    `  Input tokens    ${totals.base.inputTokens.toLocaleString('en-US')} → ` +
      `${totals.head.inputTokens.toLocaleString('en-US')}   ` +
      `(${fmtSignedTokens(totals.tokenDelta)}, ${fmtPct(totals.tokenPct)})`,
  );
  lines.push(
    `  Est. input cost ${formatUsd(totals.base.inputCostUsd)} → ` +
      `${formatUsd(totals.head.inputCostUsd)}   ` +
      `(${fmtSignedUsd(totals.costDelta)}, ${fmtPct(totals.costPct)})`,
  );
  lines.push(
    `  Call sites      ${totals.base.callSites} → ${totals.head.callSites}`,
  );

  if (diff.newPrompts.length > 0) {
    lines.push('');
    lines.push(`  New prompts (${diff.newPrompts.length}):`);
    for (const s of diff.newPrompts) lines.push(`    ${siteLine(s)}`);
  }
  if (diff.removedPrompts.length > 0) {
    lines.push('');
    lines.push(`  Removed prompts (${diff.removedPrompts.length}):`);
    for (const s of diff.removedPrompts) {
      lines.push(`    ${s.file}:${s.line} — −${s.inputTokens.toLocaleString('en-US')} tokens`);
    }
  }
  if (diff.newPrompts.length === 0 && diff.removedPrompts.length === 0) {
    lines.push('');
    lines.push('  No prompt content added or removed.');
  }

  lines.push('');
  lines.push(
    `  (estimate, input only; pricing ${diff.meta.pricingVersion}, as of ${diff.meta.pricingAsOf})`,
  );
  lines.push('');
  return lines.join('\n');
}

/** Markdown diff for a PR comment. */
export function renderDiffMarkdown(diff: DiffReport): string {
  const { totals } = diff;
  const lines: string[] = [];
  lines.push('## PromptScan');
  lines.push('');
  lines.push('| Metric | Base | Head | Δ |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| Input tokens | ${totals.base.inputTokens.toLocaleString('en-US')} | ` +
      `${totals.head.inputTokens.toLocaleString('en-US')} | ` +
      `${fmtSignedTokens(totals.tokenDelta)} (${fmtPct(totals.tokenPct)}) |`,
  );
  lines.push(
    `| Est. input cost/scan | ${formatUsd(totals.base.inputCostUsd)} | ` +
      `${formatUsd(totals.head.inputCostUsd)} | ` +
      `${fmtSignedUsd(totals.costDelta)} (${fmtPct(totals.costPct)}) |`,
  );
  lines.push(`| Call sites | ${totals.base.callSites} | ${totals.head.callSites} | |`);

  if (diff.newPrompts.length > 0) {
    lines.push('');
    lines.push(`**New prompts (${diff.newPrompts.length}):**`);
    for (const s of diff.newPrompts) lines.push(`- \`${siteLine(s)}\``);
  }
  if (diff.removedPrompts.length > 0) {
    lines.push('');
    lines.push(`**Removed prompts (${diff.removedPrompts.length}):**`);
    for (const s of diff.removedPrompts) {
      lines.push(`- \`${s.file}:${s.line}\` — −${s.inputTokens.toLocaleString('en-US')} tokens`);
    }
  }
  if (diff.newPrompts.length === 0 && diff.removedPrompts.length === 0) {
    lines.push('');
    lines.push('_No prompt content added or removed._');
  }

  lines.push('');
  lines.push(
    `<sub>estimate, input only — output tokens aren't statically knowable · ` +
      `pricing ${diff.meta.pricingVersion}, as of ${diff.meta.pricingAsOf}</sub>`,
  );
  return lines.join('\n') + '\n';
}
