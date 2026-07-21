import path from 'node:path';
import { discoverPythonFiles, type DiscoveryOptions } from './discovery/walk.js';
import { initParser, createPythonParser, parseFile } from './parse/parser.js';
import { VERSION } from './version.js';
import type { FileParseSummary, ScanReport, ScanStats } from './report/types.js';

export type { ScanReport, FileParseSummary, ScanStats } from './report/types.js';

export interface ScanOptions extends DiscoveryOptions {}

/**
 * v0.1/M1 scan: discover Python files under a target, parse each one, and
 * report parse outcomes. Later milestones layer call-site detection, prompt
 * resolution, and tokenization onto this same pass.
 */
export async function scan(target: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const root = path.resolve(target);
  const files = await discoverPythonFiles(target, opts);

  await initParser();
  const parser = createPythonParser();

  const summaries: FileParseSummary[] = [];
  const stats: ScanStats = {
    discovered: files.length,
    parsedClean: 0,
    parsedPartial: 0,
    readErrors: 0,
  };

  for (const absPath of files) {
    const relPath = path.relative(root, absPath) || path.basename(absPath);
    const outcome = await parseFile(parser, absPath);

    switch (outcome.status) {
      case 'clean':
        stats.parsedClean++;
        summaries.push({ relPath, status: 'clean' });
        outcome.tree.delete();
        break;
      case 'partial':
        stats.parsedPartial++;
        summaries.push({ relPath, status: 'partial' });
        outcome.tree.delete();
        break;
      case 'read-error':
        stats.readErrors++;
        summaries.push({ relPath, status: 'read-error', message: outcome.message });
        break;
    }
  }

  parser.delete();

  return {
    root,
    files: summaries,
    stats,
    meta: { version: VERSION, phase: 'discovery' },
  };
}
