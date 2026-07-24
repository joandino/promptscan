import type { ScanReport } from './types.js';

/**
 * Absolute thresholds for gating a scan in CI. `diff` gates on a delta between
 * two refs; these gate on the state of a single scan, for pushes and scheduled
 * runs where there is no base to compare against.
 */
export interface ScanLimits {
  /** Fail if total input cost across the scan exceeds this many USD. */
  maxTotalCostUsd?: number;
  /** Fail if any single call site's input tokens exceed this. */
  maxPromptTokens?: number;
  /** Fail if total input tokens across the scan exceed this. */
  maxTotalTokens?: number;
}

export interface LimitViolation {
  limit: string;
  message: string;
}

/**
 * Check a report against configured limits.
 *
 * Token and cost figures count statically-resolved content only, so they are a
 * FLOOR — a prompt assembled at runtime can exceed a limit without tripping it.
 * That makes these gates safe against false failures but not exhaustive, which
 * is the right trade for CI.
 */
export function checkLimits(report: ScanReport, limits: ScanLimits): LimitViolation[] {
  const violations: LimitViolation[] = [];
  const { stats } = report;

  if (limits.maxTotalCostUsd !== undefined && stats.inputCostUsd > limits.maxTotalCostUsd) {
    violations.push({
      limit: 'maxTotalCostUsd',
      message: `total input cost $${stats.inputCostUsd.toFixed(4)} exceeds limit $${limits.maxTotalCostUsd.toFixed(4)}`,
    });
  }

  if (limits.maxTotalTokens !== undefined && stats.inputTokens > limits.maxTotalTokens) {
    violations.push({
      limit: 'maxTotalTokens',
      message: `total input tokens ${stats.inputTokens.toLocaleString('en-US')} exceeds limit ${limits.maxTotalTokens.toLocaleString('en-US')}`,
    });
  }

  if (limits.maxPromptTokens !== undefined) {
    const over = report.callSites
      .filter((s) => s.prompt.status !== 'unresolved' && s.tokens.inputTokens > limits.maxPromptTokens!)
      .sort((a, b) => b.tokens.inputTokens - a.tokens.inputTokens);
    for (const site of over) {
      violations.push({
        limit: 'maxPromptTokens',
        message: `${site.file}:${site.line} — ${site.tokens.inputTokens.toLocaleString('en-US')} input tokens exceeds limit ${limits.maxPromptTokens.toLocaleString('en-US')}`,
      });
    }
  }

  return violations;
}
