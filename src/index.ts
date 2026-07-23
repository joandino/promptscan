import fs from 'node:fs';
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
import { detectTsCallSites, buildTsSymbolTable, buildTsImportMap } from './lang/typescript.js';
import { buildSymbolTable } from './resolve/symbols.js';
import { buildPyImportMap } from './resolve/imports.js';
import { createModuleResolver, type ModuleScope } from './resolve/modules.js';
import { findDuplicates, type DuplicateOptions } from './analyze/duplicates.js';
import { collectDeadPromptFile, aggregateDeadPrompts, type DeadPromptFile } from './analyze/deadprompts.js';
import { analyzeBloat, type BloatOptions } from './analyze/bloat.js';
import { analyzeCaching, type CachingOptions } from './analyze/caching.js';
import { projectMonthly, type VolumeConfig } from './pricing/cost.js';
import { PRICING_VERSION, PRICING_AS_OF } from './pricing/table.js';
import { SCHEMA_VERSION } from './report/schema.js';
import { VERSION } from './version.js';
import type { CallSite, FileParseSummary, ScanReport, ScanStats } from './report/types.js';

export type { ScanReport, FileParseSummary, ScanStats, CallSite } from './report/types.js';

export interface ScanOptions extends DiscoveryOptions, DuplicateOptions, BloatOptions {
  /** Call-volume estimate; when present, the report includes a monthly projection. */
  volume?: VolumeConfig;
  /** Prompt-caching analysis thresholds. */
  caching?: CachingOptions;
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

  // Resolves `from x import PROMPT` across sibling files within the scan by
  // parsing imported modules on demand and following the name to its constant.
  const moduleResolver = createModuleResolver({
    root,
    parse: (absPath, lang) => {
      let source: string;
      try {
        source = fs.readFileSync(absPath, 'utf8');
      } catch {
        return null;
      }
      return parserFor(lang).parse(source) ?? null;
    },
    buildScope: (absPath, lang, tree): ModuleScope => {
      const sourceDir = path.dirname(absPath);
      const language = getLanguage(lang);
      return lang === 'python'
        ? { absPath, sourceDir, symbols: buildSymbolTable(tree, language), imports: buildPyImportMap(tree, language) }
        : { absPath, sourceDir, symbols: buildTsSymbolTable(tree, language), imports: buildTsImportMap(tree, language) };
    },
  });

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
    deadPrompts: 0,
    bloatFlags: 0,
    cachedCallSites: 0,
    cacheOpportunities: 0,
    cacheSavingsPerCallUsd: 0,
  };
  const deadData: DeadPromptFile[] = [];

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
    deadData.push(collectDeadPromptFile(outcome.tree, language, lang, relPath));

    const detected =
      lang === 'python'
        ? detectCallSites(outcome.tree, language, relPath, absPath, moduleResolver)
        : detectTsCallSites(outcome.tree, language, relPath, absPath, moduleResolver);
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

  moduleResolver.dispose();
  for (const p of parsers.values()) p.delete();

  callSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  const duplicates = findDuplicates(callSites, opts);
  stats.exactDuplicateGroups = duplicates.exact.length;
  stats.nearDuplicatePairs = duplicates.near.length;

  const deadPrompts = aggregateDeadPrompts(deadData);
  stats.deadPrompts = deadPrompts.length;

  const bloat = analyzeBloat(callSites, opts);
  stats.bloatFlags = bloat.oversized.length + bloat.fewShot.length + bloat.boilerplate.length;

  const caching = analyzeCaching(callSites, opts.caching);
  stats.cachedCallSites = caching.cachedSites;
  stats.cacheOpportunities = caching.opportunities.length;
  stats.cacheSavingsPerCallUsd = caching.totalSavingsPerCallUsd;

  const projection = opts.volume ? projectMonthly(callSites, opts.volume) : null;

  return {
    root,
    files: summaries,
    callSites,
    duplicates,
    deadPrompts,
    bloat,
    caching,
    projection,
    stats,
    meta: {
      version: VERSION,
      phase: 'cost',
      pricingVersion: PRICING_VERSION,
      pricingAsOf: PRICING_AS_OF,
      schemaVersion: SCHEMA_VERSION,
    },
  };
}
