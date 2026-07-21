import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface Materialized {
  /** Directory to scan (the target path extracted at the ref). */
  dir: string;
  /** Remove the temporary extraction. Always call in a finally. */
  cleanup: () => void;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Extract `targetPath` at a git `ref` into a temp directory using `git archive`,
 * so both sides of a diff can be scanned without touching the working tree.
 * A path that didn't exist at the ref yields an empty directory (0 files),
 * not an error — so diffs of newly-added trees still work.
 */
export function materializeRef(ref: string, targetPath: string, cwd: string): Materialized {
  try {
    git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new Error(`git ref not found: ${ref} (is this a git repository?)`);
  }

  const root = mkdtempSync(path.join(tmpdir(), 'promptscan-diff-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  const tarPath = path.join(root, 'tree.tar');
  const treeDir = path.join(root, 'tree');
  mkdirSync(treeDir, { recursive: true });

  try {
    git(cwd, ['archive', '--format=tar', '--output', tarPath, ref, '--', targetPath]);
    execFileSync('tar', ['-xf', tarPath, '-C', treeDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A pathspec that matched nothing at this ref = an empty tree, not a failure.
    if (!/did not match any files|pathspec/.test(msg)) {
      cleanup();
      throw new Error(`git archive failed for ${ref} -- ${targetPath}: ${msg}`);
    }
  }

  const scanDir = path.join(treeDir, targetPath);
  if (!existsSync(scanDir)) mkdirSync(scanDir, { recursive: true });
  return { dir: scanDir, cleanup };
}
