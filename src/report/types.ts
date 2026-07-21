/**
 * Shared report types. v0.1/M1 only populates discovery + parse fields;
 * later milestones (call sites, prompts, tokens) extend ScanReport without
 * reshaping what exists here.
 */

export type FileStatus = 'clean' | 'partial' | 'read-error';

export interface FileParseSummary {
  /** Path relative to the scan root, for display. */
  relPath: string;
  status: FileStatus;
  /** Present when status is 'read-error'. */
  message?: string;
}

export interface ScanStats {
  discovered: number;
  parsedClean: number;
  parsedPartial: number;
  readErrors: number;
}

export interface ScanReport {
  /** Absolute path of the scan target. */
  root: string;
  files: FileParseSummary[];
  stats: ScanStats;
  meta: {
    version: string;
    /** Current roadmap phase implemented by this build. */
    phase: string;
  };
}
