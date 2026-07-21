/**
 * Shared report types. v0.1/M1 only populates discovery + parse fields;
 * later milestones (call sites, prompts, tokens) extend ScanReport without
 * reshaping what exists here.
 */

export type FileStatus = 'clean' | 'partial' | 'read-error';

export type Provider = 'openai' | 'anthropic';

/** How confident detection is that a call site is a real LLM invocation. */
export type Confidence = 'high' | 'medium';

/** What raised the call site to a reportable confidence. */
export type MatchBasis =
  | 'shape' // distinctive method chain alone (e.g. chat.completions.create)
  | 'import' // corroborated by an SDK import in the file
  | 'binding'; // receiver variable bound to a known client constructor

export interface CallSite {
  /** Path relative to the scan root. */
  file: string;
  line: number;
  column: number;
  provider: Provider;
  /** Normalized method, e.g. 'chat.completions.create'. */
  method: string;
  /** Resolved model string, or null when dynamic/unresolved. */
  model: string | null;
  modelResolved: boolean;
  /** Raw source of a dynamic model argument, for display (e.g. 'MODEL'). */
  modelHint: string | null;
  /** Base receiver variable, e.g. 'client', or null if not a plain name. */
  receiver: string | null;
  confidence: Confidence;
  basis: MatchBasis;
}

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
  /** Total detected LLM call sites. */
  callSites: number;
  /** Call sites whose model argument resolved to a literal. */
  modelsResolved: number;
}

export interface ScanReport {
  /** Absolute path of the scan target. */
  root: string;
  files: FileParseSummary[];
  callSites: CallSite[];
  stats: ScanStats;
  meta: {
    version: string;
    /** Current roadmap phase implemented by this build. */
    phase: string;
  };
}
