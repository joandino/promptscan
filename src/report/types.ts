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

/** Whether a prompt (or a part of it) could be statically determined. */
export type ResolutionStatus = 'resolved' | 'partial' | 'unresolved';

/** Where a resolved value ultimately came from. */
export type ResolutionSource = 'literal' | 'concat' | 'fstring' | 'const' | 'file' | 'unknown';

/** A run of prompt text: known (`static`) or a runtime hole (`dynamic`). */
export interface PromptSegment {
  kind: 'static' | 'dynamic';
  /** For static, the literal text; for dynamic, a short label of the source. */
  text: string;
}

export interface ResolvedValue {
  status: ResolutionStatus;
  /** Concatenation of static segments — the statically-known text. */
  text: string;
  segments: PromptSegment[];
  source: ResolutionSource;
  /** Present when status is not 'resolved': why. */
  reason?: string;
}

/** Which argument a prompt part came from. */
export type PromptOrigin = 'messages' | 'system' | 'input' | 'instructions' | 'prompt';

export interface PromptPart {
  /** Message role when known (system/user/assistant), else null. */
  role: string | null;
  origin: PromptOrigin;
  value: ResolvedValue;
}

export interface ResolvedPrompt {
  /** Aggregate over all parts. */
  status: ResolutionStatus;
  parts: PromptPart[];
  /** Present when nothing could be extracted at all. */
  reason?: string;
}

/**
 * Static estimate of a call site's INPUT tokens. Output tokens are not
 * statically knowable and are never included.
 */
export interface TokenEstimate {
  /** Tokens in statically-known prompt content. */
  contentTokens: number;
  /** Structural tokens (roles, per-message, priming). */
  overheadTokens: number;
  /** contentTokens + overheadTokens. */
  inputTokens: number;
  /** True when a proxy tokenizer, a fallback encoding, or partial content is involved. */
  approximate: boolean;
  /** Encoding used, e.g. 'o200k_base' or 'cl100k_base (anthropic proxy)'. */
  encoding: string;
  /** Caveats a reader must see (proxy tokenizer, partial floor, etc.). */
  notes: string[];
}

/**
 * Static estimate of a call site's INPUT cost (USD), from token count ×
 * per-model pricing. Output cost is never included — output tokens aren't
 * statically knowable.
 */
export interface CostEstimate {
  /** Input cost of one call, or null when the model isn't in the pricing table. */
  inputCostUsd: number | null;
  /** Input price per 1M tokens used, or null when unpriced. */
  pricePerMTok: number | null;
  /** Canonical model id the price came from, or null when unpriced. */
  pricedAs: string | null;
}

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
  /** Statically-resolved prompt content (M3). */
  prompt: ResolvedPrompt;
  /** Input-token estimate for the resolved prompt (M4). */
  tokens: TokenEstimate;
  /** Input-cost estimate for the resolved prompt (v0.3). */
  cost: CostEstimate;
}

/** Per-site monthly projection, when a call-volume estimate is supplied. */
export interface MonthlyProjectionSite {
  file: string;
  line: number;
  callsPerMonth: number;
  /** callsPerMonth × per-call input cost, or null when unpriced. */
  monthlyInputCostUsd: number | null;
}

export interface MonthlyProjection {
  monthlyInputTokens: number;
  monthlyInputCostUsd: number;
  /** Call sites whose model isn't priced (excluded from the cost total). */
  unpriced: number;
  sites: MonthlyProjectionSite[];
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
  /** Call sites whose prompt fully resolved. */
  promptsResolved: number;
  /** Call sites with a mix of static and dynamic prompt content. */
  promptsPartial: number;
  /** Call sites whose prompt could not be resolved at all. */
  promptsUnresolved: number;
  /** Total estimated input tokens across call sites with countable content. */
  inputTokens: number;
  /** True if any counted call site used a proxy/fallback tokenizer or partial content. */
  tokensApproximate: boolean;
  /** Number of exact-duplicate groups. */
  exactDuplicateGroups: number;
  /** Number of near-duplicate pairs. */
  nearDuplicatePairs: number;
  /** Total estimated input cost (USD) across priced call sites. */
  inputCostUsd: number;
  /** Call sites whose model has no pricing-table entry. */
  unpricedCallSites: number;
  /** Prompt constants with no reachable reference (heuristic). */
  deadPrompts: number;
}

/** A call-site location, for referencing from duplicate reports. */
export interface SiteRef {
  file: string;
  line: number;
}

/** A set of call sites whose resolved prompt text is identical (after normalization). */
export interface DuplicateGroup {
  /** The shared normalized prompt text. */
  text: string;
  /** Input-token count of the shared prompt (one instance). */
  tokens: number;
  sites: SiteRef[];
}

/** Two call sites whose prompts are similar but not identical. */
export interface NearDuplicatePair {
  similarity: number; // 0..1 token-set Jaccard
  a: SiteRef;
  b: SiteRef;
}

export interface DuplicateReport {
  exact: DuplicateGroup[];
  near: NearDuplicatePair[];
  /** Similarity threshold used for near-duplicates. */
  threshold: number;
  /** Prompts with fewer distinct words than this were excluded from analysis. */
  minWords: number;
  /** Number of distinct resolved prompts compared. */
  comparedPrompts: number;
  /** Set when near-duplicate analysis was capped/skipped (no silent limits). */
  nearNote?: string;
}

/**
 * A prompt-shaped string constant with no reachable reference anywhere in the
 * scanned code. Heuristic — reported conservatively; see the analyzer.
 */
export interface DeadPrompt {
  file: string;
  line: number;
  name: string;
  /** Input tokens of the unused prompt text. */
  tokens: number;
}

export interface ScanReport {
  /** Absolute path of the scan target. */
  root: string;
  files: FileParseSummary[];
  callSites: CallSite[];
  duplicates: DuplicateReport;
  /** Prompt constants with no reachable call site (v0.5, heuristic). */
  deadPrompts: DeadPrompt[];
  /** Monthly cost projection, present only when a volume estimate is supplied. */
  projection: MonthlyProjection | null;
  stats: ScanStats;
  meta: {
    version: string;
    /** Current roadmap phase implemented by this build. */
    phase: string;
    /** Pricing-table version and as-of date behind the cost figures. */
    pricingVersion: string;
    pricingAsOf: string;
  };
}
