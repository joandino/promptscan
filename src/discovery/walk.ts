import path from 'node:path';
import { stat } from 'node:fs/promises';
import { globby } from 'globby';

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
  '**/site-packages/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.tox/**',
];

export interface DiscoveryOptions {
  /** Respect .gitignore files under the target. Default true. */
  gitignore?: boolean;
}

/**
 * Resolve a scan target (file or directory) to a sorted list of absolute
 * paths to Python files. A single .py file is returned as-is; a directory is
 * walked recursively with sensible ignores.
 *
 * Throws if the target does not exist.
 */
export async function discoverPythonFiles(
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
    return absTarget.endsWith('.py') ? [absTarget] : [];
  }

  const matches = await globby('**/*.py', {
    cwd: absTarget,
    absolute: true,
    ignore: DEFAULT_IGNORES,
    gitignore: opts.gitignore ?? true,
    dot: false,
    followSymbolicLinks: false,
  });

  return matches.sort();
}
