import type { Parser, Language } from 'web-tree-sitter';
import type { LangId } from '../src/parse/lang.js';
import { detectCallSites } from '../src/detect/callsites.js';
import { detectTsCallSites } from '../src/lang/typescript.js';
import { findDuplicates } from '../src/analyze/duplicates.js';
import { analyzeBloat } from '../src/analyze/bloat.js';
import { collectDeadPromptFile, aggregateDeadPrompts } from '../src/analyze/deadprompts.js';
import { PRICING_VERSION, PRICING_AS_OF } from '../src/pricing/table.js';
import type { BloatReport, CallSite, DeadPrompt, DuplicateReport } from '../src/report/types.js';

/**
 * The subset of a scan that runs in a browser: a single pasted source string.
 * No filesystem, so cross-module resolution and file-loads are unavailable — a
 * name imported from another file resolves as unresolved, honestly. Everything
 * else (detection, literal/const/f-string resolution, tokens, cost, duplicates,
 * dead-within-file, bloat) is the exact same code the CLI runs.
 */
export interface SnippetReport {
  callSites: CallSite[];
  duplicates: DuplicateReport;
  deadPrompts: DeadPrompt[];
  bloat: BloatReport;
  stats: {
    callSites: number;
    modelsResolved: number;
    promptsResolved: number;
    promptsPartial: number;
    promptsUnresolved: number;
    inputTokens: number;
    tokensApproximate: boolean;
    inputCostUsd: number;
    unpricedCallSites: number;
    exactDuplicateGroups: number;
    nearDuplicatePairs: number;
    deadPrompts: number;
    bloatFlags: number;
  };
  pricingVersion: string;
  pricingAsOf: string;
}

const REL_PATH: Record<LangId, string> = {
  python: 'snippet.py',
  typescript: 'snippet.ts',
  tsx: 'snippet.tsx',
};

/** Scan a single source string. `parser`/`language` are provided by the caller (Node or browser). */
export function scanSnippet(code: string, langId: LangId, parser: Parser, language: Language): SnippetReport {
  const tree = parser.parse(code);
  if (!tree) throw new Error('parser returned no tree');

  const relPath = REL_PATH[langId];
  const absPath = `/${relPath}`; // fake dir; no moduleResolver → cross-module disabled

  const callSites = (
    langId === 'python'
      ? detectCallSites(tree, language, relPath, absPath)
      : detectTsCallSites(tree, language, relPath, absPath)
  ).sort((a, b) => a.line - b.line || a.column - b.column);

  const deadPrompts = aggregateDeadPrompts([collectDeadPromptFile(tree, language, langId, relPath)]);
  const duplicates = findDuplicates(callSites, {});
  const bloat = analyzeBloat(callSites, {});
  tree.delete();

  let modelsResolved = 0;
  let promptsResolved = 0;
  let promptsPartial = 0;
  let promptsUnresolved = 0;
  let inputTokens = 0;
  let tokensApproximate = false;
  let inputCostUsd = 0;
  let unpricedCallSites = 0;

  for (const s of callSites) {
    if (s.modelResolved) modelsResolved++;
    if (s.prompt.status === 'resolved') promptsResolved++;
    else if (s.prompt.status === 'partial') promptsPartial++;
    else promptsUnresolved++;
    if (s.prompt.status !== 'unresolved') {
      inputTokens += s.tokens.inputTokens;
      if (s.tokens.approximate) tokensApproximate = true;
      if (s.cost.inputCostUsd !== null) inputCostUsd += s.cost.inputCostUsd;
      else unpricedCallSites++;
    }
  }

  return {
    callSites,
    duplicates,
    deadPrompts,
    bloat,
    stats: {
      callSites: callSites.length,
      modelsResolved,
      promptsResolved,
      promptsPartial,
      promptsUnresolved,
      inputTokens,
      tokensApproximate,
      inputCostUsd,
      unpricedCallSites,
      exactDuplicateGroups: duplicates.exact.length,
      nearDuplicatePairs: duplicates.near.length,
      deadPrompts: deadPrompts.length,
      bloatFlags: bloat.oversized.length + bloat.fewShot.length + bloat.boilerplate.length,
    },
    pricingVersion: PRICING_VERSION,
    pricingAsOf: PRICING_AS_OF,
  };
}
