import path from 'node:path';
import { discoverPythonFiles, type DiscoveryOptions } from './discovery/walk.js';
import { initParser, createPythonParser, parseFile, getPythonLanguage } from './parse/parser.js';
import { detectCallSites } from './detect/callsites.js';
import { VERSION } from './version.js';
import type { CallSite, FileParseSummary, ScanReport, ScanStats } from './report/types.js';

export type { ScanReport, FileParseSummary, ScanStats, CallSite } from './report/types.js';

export interface ScanOptions extends DiscoveryOptions {}

/**
 * v0.1 scan: discover Python files, parse each, and detect OpenAI/Anthropic
 * call sites (M2). Prompt resolution and tokenization layer onto this pass in
 * later milestones.
 */
export async function scan(target: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const root = path.resolve(target);
  const files = await discoverPythonFiles(target, opts);

  await initParser();
  const parser = createPythonParser();
  const language = getPythonLanguage();

  const summaries: FileParseSummary[] = [];
  const callSites: CallSite[] = [];
  const stats: ScanStats = {
    discovered: files.length,
    parsedClean: 0,
    parsedPartial: 0,
    readErrors: 0,
    callSites: 0,
    modelsResolved: 0,
  };

  for (const absPath of files) {
    const relPath = path.relative(root, absPath) || path.basename(absPath);
    const outcome = await parseFile(parser, absPath);

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
    for (const site of detectCallSites(outcome.tree, language, relPath)) {
      callSites.push(site);
      stats.callSites++;
      if (site.modelResolved) stats.modelsResolved++;
    }

    outcome.tree.delete();
  }

  parser.delete();

  callSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

  return {
    root,
    files: summaries,
    callSites,
    stats,
    meta: { version: VERSION, phase: 'detection' },
  };
}
