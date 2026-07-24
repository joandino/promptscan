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
  /** Extra paths to skip, in .gitignore-style patterns (see `normalizeExcludes`). */
  exclude?: string[];
}

const GLOB_CHARS = /[*?[\]{}!]/;

/**
 * Expand user exclude patterns to globs, following .gitignore conventions so
 * they behave the way people already expect:
 *
 *   `website`        → any directory or file named `website`, at any depth
 *   `src/generated`  → that path, anchored at the scan root
 *   `**\/*.test.py`  → passed through untouched (already a glob)
 *
 * A bare name matching at any depth is the important case: `--exclude website`
 * should skip `a/b/website/`, not just a top-level one.
 */
export function normalizeExcludes(patterns: string[]): string[] {
  const out: string[] = [];
  for (const raw of patterns) {
    const p = raw.trim().replace(/\/+$/, '');
    if (!p) continue;
    if (GLOB_CHARS.test(p)) {
      out.push(p);
      continue;
    }
    // Anchored when the pattern contains a slash, any-depth when it doesn't.
    const base = p.includes('/') ? p : `**/${p}`;
    out.push(base, `${base}/**`);
  }
  return out;
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
    ignore: [...DEFAULT_IGNORES, ...normalizeExcludes(opts.exclude ?? [])],
    gitignore: opts.gitignore ?? true,
    dot: false,
    followSymbolicLinks: false,
  });

  return matches.sort();
}
