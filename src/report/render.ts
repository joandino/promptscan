import type { ScanReport } from './types.js';
import { renderCallSiteTable, formatUsd } from './table.js';

/**
 * Render the M1 discovery summary as a human-readable terminal block.
 * Leads with counts; lists partial and unreadable files explicitly so nothing
 * is silently dropped from the analysis.
 */
export function renderScanSummary(report: ScanReport): string {
  const { stats, files } = report;
  const lines: string[] = [];

  lines.push('');
  lines.push(`PromptScan v${report.meta.version}  (phase: ${report.meta.phase})`);
  lines.push('');
  lines.push(`  Scanned:  ${report.root}`);
  lines.push(`  Files:    ${stats.discovered} source file${stats.discovered === 1 ? '' : 's'}`);

  if (stats.discovered === 0) {
    lines.push('');
    lines.push('  No source files found under the target.');
    lines.push('');
    return lines.join('\n') + '\n';
  }

  lines.push('');
  lines.push(
    `  Parsed:   ${stats.parsedClean} clean, ` +
      `${stats.parsedPartial} partial (recoverable), ` +
      `${stats.readErrors} unreadable`,
  );

  const partials = files.filter((f) => f.status === 'partial');
  if (partials.length > 0) {
    lines.push('');
    lines.push('  Partial parses (syntax errors, still analyzed):');
    for (const f of partials) lines.push(`    ${f.relPath}`);
  }

  const unreadable = files.filter((f) => f.status === 'read-error');
  if (unreadable.length > 0) {
    lines.push('');
    lines.push('  Unreadable files (skipped):');
    for (const f of unreadable) lines.push(`    ${f.relPath}${f.message ? ` — ${f.message}` : ''}`);
  }

  lines.push('');
  lines.push(renderCallSites(report));
  const dup = renderDuplicates(report);
  if (dup) lines.push('', dup);
  const dead = renderDeadPrompts(report);
  if (dead) lines.push('', dead);
  const bloat = renderBloat(report);
  if (bloat) lines.push('', bloat);
  const proj = renderProjection(report);
  if (proj) lines.push('', proj);
  return lines.join('\n') + '\n';
}

function renderBloat(report: ScanReport): string {
  const { oversized, fewShot, boilerplate, thresholds } = report.bloat;
  if (oversized.length === 0 && fewShot.length === 0 && boilerplate.length === 0) return '';

  const lines: string[] = ['  Context bloat (heuristics):'];

  if (oversized.length > 0) {
    lines.push(`    Oversized prompts (≥${thresholds.largeTokens.toLocaleString('en-US')} tok):`);
    for (const o of oversized) {
      lines.push(`      ${o.file}:${o.line} — ${o.tokens.toLocaleString('en-US')} tok`);
    }
  }
  if (fewShot.length > 0) {
    lines.push(`    Many-message prompts (≥${thresholds.manyMessages} parts, possible few-shot):`);
    for (const f of fewShot) {
      lines.push(`      ${f.file}:${f.line} — ${f.messageCount} messages, ${f.tokens.toLocaleString('en-US')} tok`);
    }
  }
  if (boilerplate.length > 0) {
    lines.push(`    Repeated boilerplate (≥${thresholds.boilerplateMinSites} sites — extract or cache):`);
    for (const b of boilerplate) {
      lines.push(`      ×${b.sites.length}, ${b.tokens} tok each: "${preview(b.text)}"`);
      lines.push(`          ${b.sites.map((s) => `${s.file}:${s.line}`).join('  ')}`);
    }
  }
  return lines.join('\n');
}

function renderDeadPrompts(report: ScanReport): string {
  const dead = report.deadPrompts;
  if (dead.length === 0) return '';
  const lines: string[] = [];
  lines.push(`  Possibly-unused prompts: ${dead.length} (heuristic — verify before deleting)`);
  for (const d of dead) {
    lines.push(`    ${d.file}:${d.line} — ${d.name} (${d.tokens} tok, no reachable reference)`);
  }
  return lines.join('\n');
}

function renderProjection(report: ScanReport): string {
  const p = report.projection;
  if (!p || p.sites.length === 0) return '';

  const lines: string[] = [];
  const unpriced = p.unpriced > 0 ? ` (${p.unpriced} unpriced, excluded)` : '';
  lines.push(
    `  Monthly projection: ${formatUsd(p.monthlyInputCostUsd)}/mo input cost, ` +
      `${p.monthlyInputTokens.toLocaleString('en-US')} input tok/mo${unpriced}`,
  );
  const top = p.sites.slice(0, 5);
  for (const s of top) {
    const cost = s.monthlyInputCostUsd === null ? 'unpriced' : `${formatUsd(s.monthlyInputCostUsd)}/mo`;
    lines.push(`      ${s.file}:${s.line} — ${s.callsPerMonth.toLocaleString('en-US')} calls/mo → ${cost}`);
  }
  if (p.sites.length > top.length) {
    lines.push(`      … and ${p.sites.length - top.length} more call sites`);
  }
  return lines.join('\n');
}

function loc(ref: { file: string; line: number }): string {
  return `${ref.file}:${ref.line}`;
}

function preview(text: string, max = 56): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function renderDuplicates(report: ScanReport): string {
  const { exact, near, threshold, nearNote } = report.duplicates;
  if (exact.length === 0 && near.length === 0 && !nearNote) return '';

  const lines: string[] = [];
  const wasted = exact.reduce((n, g) => n + g.tokens * (g.sites.length - 1), 0);
  lines.push(
    `  Duplicates: ${exact.length} exact group${exact.length === 1 ? '' : 's'}, ` +
      `${near.length} near-dup pair${near.length === 1 ? '' : 's'} (≥${threshold})`,
  );
  if (wasted > 0) {
    lines.push(`              ~${wasted.toLocaleString('en-US')} input tokens in repeated prompt copies`);
  }

  for (const g of exact) {
    lines.push('');
    lines.push(`  exact ×${g.sites.length} (${g.tokens} tok each): "${preview(g.text)}"`);
    for (const s of g.sites) lines.push(`      ${loc(s)}`);
  }

  if (near.length > 0) {
    lines.push('');
    lines.push('  near-duplicates:');
    for (const p of near) {
      lines.push(`      ${p.similarity.toFixed(2)}  ${loc(p.a)}  ~  ${loc(p.b)}`);
    }
  }

  if (nearNote) {
    lines.push('');
    lines.push(`  note: ${nearNote}`);
  }

  return lines.join('\n');
}

function renderCallSites(report: ScanReport): string {
  const { callSites, stats } = report;
  const lines: string[] = [];

  if (callSites.length === 0) {
    lines.push('  Call sites: none detected (OpenAI / Anthropic / LangChain / litellm)');
    return lines.join('\n');
  }

  const openai = callSites.filter((c) => c.provider === 'openai').length;
  const anthropic = callSites.filter((c) => c.provider === 'anthropic').length;
  const other = callSites.filter((c) => c.provider === 'other').length;
  const unresolvedModels = stats.callSites - stats.modelsResolved;

  const breakdown = [`openai ${openai}`, `anthropic ${anthropic}`];
  if (other > 0) breakdown.push(`other ${other}`);
  lines.push(`  Call sites: ${stats.callSites} (${breakdown.join(', ')})`);
  lines.push(
    `  Models:     ${stats.modelsResolved} resolved, ${unresolvedModels} unresolved`,
  );
  lines.push(
    `  Prompts:    ${stats.promptsResolved} resolved, ` +
      `${stats.promptsPartial} partial, ${stats.promptsUnresolved} unresolved`,
  );
  const approx = stats.tokensApproximate ? '~' : '';
  lines.push(
    `  Input tok:  ${approx}${stats.inputTokens.toLocaleString('en-US')} ` +
      `(estimate, input only — output tokens are not statically knowable)`,
  );
  const unpriced = stats.unpricedCallSites > 0 ? `, ${stats.unpricedCallSites} unpriced` : '';
  lines.push(
    `  Input cost: ${approx}${formatUsd(stats.inputCostUsd)}/scan ` +
      `(estimate, input only${unpriced}; pricing ${report.meta.pricingVersion}, as of ${report.meta.pricingAsOf})`,
  );
  lines.push('');
  lines.push(
    renderCallSiteTable(callSites)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  );

  const notFull = callSites.filter((c) => c.prompt.status !== 'resolved');
  if (notFull.length > 0) {
    lines.push('');
    lines.push('  Prompts needing attention:');
    for (const c of notFull) {
      const reason = c.prompt.reason ?? 'see call site';
      lines.push(`    ${c.file}:${c.line} — ${c.prompt.status}: ${reason}`);
    }
  }

  return lines.join('\n');
}
