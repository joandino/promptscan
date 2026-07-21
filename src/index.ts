import path from 'node:path';
import type { Parser } from 'web-tree-sitter';
import { discoverSourceFiles, type DiscoveryOptions } from './discovery/walk.js';
import {
  initParser,
  createParser,
  getLanguage,
  parseFile,
  langForExtension,
  type LangId,
} from './parse/parser.js';
import { detectCallSites } from './detect/callsites.js';
import { detectTsCallSites } from './lang/typescript.js';
import { findDuplicates, type DuplicateOptions } from './analyze/duplicates.js';
import { projectMonthly, type VolumeConfig } from './pricing/cost.js';
import { PRICING_VERSION, PRICING_AS_OF } from './pricing/table.js';
import { VERSION } from './version.js';
import type { CallSite, FileParseSummary, ScanReport, ScanStats } from './report/types.js';

export type { ScanReport, FileParseSummary, ScanStats, CallSite } from './report/types.js';

export interface ScanOptions extends DiscoveryOptions, DuplicateOptions {
  /** Call-volume estimate; when present, the report includes a monthly projection. */
  volume?: VolumeConfig;
}

/**
 * Scan a target: discover supported source files (Python, TypeScript,
 * JavaScript), parse each with the right grammar, detect OpenAI/Anthropic call
 * sites, resolve prompts, count tokens, estimate cost, and find duplicates.
 */
export async function scan(target: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const root = path.resolve(target);
  const files = await discoverSourceFiles(target, opts);

  await initParser();
  const parsers = new Map<LangId, Parser>();
  const parserFor = (id: LangId): Parser => {
    let p = parsers.get(id);
    if (!p) {
      p = createParser(id);
      parsers.set(id, p);
    }
    return p;
  };

  const summaries: FileParseSummary[] = [];
  const callSites: CallSite[] = [];
  const stats: ScanStats = {
    discovered: files.length,
    parsedClean: 0,
    parsedPartial: 0,
    readErrors: 0,
    callSites: 0,
    modelsResolved: 0,
    promptsResolved: 0,
    promptsPartial: 0,
    promptsUnresolved: 0,
    inputTokens: 0,
    tokensApproximate: false,
    exactDuplicateGroups: 0,
    nearDuplicatePairs: 0,
    inputCostUsd: 0,
    unpricedCallSites: 0,
  };

  for (const absPath of files) {
    const relPath = path.relative(root, absPath) || path.basename(absPath);
    const lang = langForExtension(path.extname(absPath));
    if (!lang) continue; // discovery already filtered, but keep the type honest

    const outcome = await parseFile(parserFor(lang), absPath);

    if (outcome.status === 'read-error') {
      stats.readErrors++;
      summaries.push({ relPath, status: 'read-error', message: outcome.message });
      continue;
    }

    if (outcome.status === 'clean') {
      stats.parsedClean++;
      summaries.push({ relPath, status: 'clean' });
    } else {
      stats.parsedPartial++;
      summaries.push({ relPath, status: 'partial' });
    }

    // Detection runs on partial trees too — tree-sitter recovers enough.
    const language = getLanguage(lang);
    const detected =
      lang === 'python'
        ? detectCallSites(outcome.tree, language, relPath, absPath)
        : detectTsCallSites(outcome.tree, language, relPath, absPath);
    for (const site of detected) {
      callSites.push(site);
      stats.callSites++;
      if (site.modelResolved) stats.modelsResolved++;
      if (site.prompt.status === 'resolved') stats.promptsResolved++;
      else if (site.prompt.status === 'partial') stats.promptsPartial++;
      else stats.promptsUnresolved++;
      // Count tokens/cost only where content was countable (resolved or partial).
      if (site.prompt.status !== 'unresolved') {
        stats.inputTokens += site.tokens.inputTokens;
        if (site.tokens.approximate) stats.tokensApproximate = true;
        if (site.cost.inputCostUsd !== null) stats.inputCostUsd += site.cost.inputCostUsd;
        else stats.unpricedCallSites++;
      }
    }

    outcome.tree.delete();
  }

  for (const p of parsers.values()) p.delete();

  callSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const duplicates = findDuplicates(callSites, opts);
  stats.exactDuplicateGroups = duplicates.exact.length;
  stats.nearDuplicatePairs = duplicates.near.length;

  const projection = opts.volume ? projectMonthly(callSites, opts.volume) : null;

  return {
    root,
    files: summaries,
    callSites,
    duplicates,
    projection,
    stats,
    meta: {
      version: VERSION,
      phase: 'cost',
      pricingVersion: PRICING_VERSION,
      pricingAsOf: PRICING_AS_OF,
    },
  };
}
