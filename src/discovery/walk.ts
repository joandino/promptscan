import path from 'node:path';
import { stat } from 'node:fs/promises';
import { globby } from 'globby';
import { langForExtension } from '../parse/parser.js';

/** File extensions PromptScan parses. */
const SUPPORTED_GLOB = '**/*.{py,ts,tsx,mts,cts,js,jsx,mjs,cjs}';

/** Directories never worth scanning for LLM call sites. */
const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.venv/**',
  '**/venv/**',
  '**/env/**',
  '**/__pycache__/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  '**/site-packages/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.tox/**',
  '**/*.d.ts',
  '**/*.min.js',
];

export interface DiscoveryOptions {
  /** Respect .gitignore files under the target. Default true. */
  gitignore?: boolean;
}

/**
 * Resolve a scan target (file or directory) to a sorted list of absolute
 * paths to supported source files (Python, TypeScript, JavaScript). A single
 * file is returned as-is when its extension is supported; a directory is walked
 * recursively with sensible ignores.
 *
 * Throws if the target does not exist.
 */
export async function discoverSourceFiles(
  target: string,
  opts: DiscoveryOptions = {},
): Promise<string[]> {
  const absTarget = path.resolve(target);

  let info;
  try {
    info = await stat(absTarget);
  } catch {
    throw new Error(`path not found: ${target}`);
  }

  if (info.isFile()) {
    return langForExtension(path.extname(absTarget)) ? [absTarget] : [];
  }

  const matches = await globby(SUPPORTED_GLOB, {
    cwd: absTarget,
    absolute: true,
    ignore: DEFAULT_IGNORES,
    gitignore: opts.gitignore ?? true,
    dot: false,
    followSymbolicLinks: false,
  });

  return matches.sort();
}
