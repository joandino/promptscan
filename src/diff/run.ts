import { scan, type ScanOptions } from '../index.js';
import { materializeRef } from './git.js';
import { computeDiff, exceedsIncrease, type DiffReport, type DiffOptions } from './diff.js';

export interface RunDiffOptions extends DiffOptions {
  /** Scan options applied to both refs (gitignore, similarity threshold). */
  scan?: ScanOptions;
  /** Fail (exit non-zero) if the metric increases by more than this percent. */
  failOnIncreasePct?: number;
  /** Metric the gate applies to. Default 'tokens'. */
  metric?: 'tokens' | 'cost';
}

export interface RunDiffResult {
  diff: DiffReport;
  /** True when the increase gate was exceeded. */
  failed: boolean;
}

/**
 * Materialize `targetPath` at two git refs, scan both, and diff them.
 * Runs git in `cwd` (defaults to process.cwd()).
 */
export async function runDiff(
  baseRef: string,
  headRef: string,
  targetPath = '.',
  cwd = process.cwd(),
  opts: RunDiffOptions = {},
): Promise<RunDiffResult> {
  const base = materializeRef(baseRef, targetPath, cwd);
  try {
    const head = materializeRef(headRef, targetPath, cwd);
    try {
      const baseReport = await scan(base.dir, opts.scan);
      const headReport = await scan(head.dir, opts.scan);
      const diff = computeDiff(baseReport, headReport, { threshold: opts.threshold });

      const failed =
        opts.failOnIncreasePct !== undefined &&
        exceedsIncrease(diff, opts.metric ?? 'tokens', opts.failOnIncreasePct);

      return { diff, failed };
    } finally {
      head.cleanup();
    }
  } finally {
    base.cleanup();
  }
}
