/**
 * Browser stub for `node:fs`. The playground scans a single pasted snippet, so
 * there is no filesystem: `open(...).read()` file-loads and cross-module reads
 * throw here and are caught by their callers, which report the value as
 * honestly unresolved (never guessed).
 */
function unavailable(): never {
  throw new Error('filesystem unavailable in the browser playground');
}

export const readFileSync = unavailable as unknown as typeof import('node:fs').readFileSync;
export const statSync = unavailable as unknown as typeof import('node:fs').statSync;
export const existsSync = (() => false) as unknown as typeof import('node:fs').existsSync;

export default { readFileSync, statSync, existsSync };
