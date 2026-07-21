import type { ScanReport } from './types.js';
import { renderCallSiteTable } from './table.js';

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
  lines.push(`  Files:    ${stats.discovered} Python file${stats.discovered === 1 ? '' : 's'}`);

  if (stats.discovered === 0) {
    lines.push('');
    lines.push('  No Python files found under the target.');
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
  return lines.join('\n') + '\n';
}

function renderCallSites(report: ScanReport): string {
  const { callSites, stats } = report;
  const lines: string[] = [];

  if (callSites.length === 0) {
    lines.push('  Call sites: none detected (OpenAI / Anthropic)');
    return lines.join('\n');
  }

  const openai = callSites.filter((c) => c.provider === 'openai').length;
  const anthropic = callSites.filter((c) => c.provider === 'anthropic').length;
  const unresolvedModels = stats.callSites - stats.modelsResolved;

  lines.push(
    `  Call sites: ${stats.callSites} ` +
      `(openai ${openai}, anthropic ${anthropic})`,
  );
  lines.push(
    `  Models:     ${stats.modelsResolved} resolved, ${unresolvedModels} unresolved`,
  );
  lines.push(
    `  Prompts:    ${stats.promptsResolved} resolved, ` +
      `${stats.promptsPartial} partial, ${stats.promptsUnresolved} unresolved`,
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
