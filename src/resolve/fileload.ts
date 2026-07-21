import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Node } from 'web-tree-sitter';
import { firstPositionalArg, staticString } from './nodes.js';

/** Cap on prompt files we will read, to avoid pathological inputs. */
const MAX_FILE_BYTES = 1_000_000;

/** True if a call's callee is `name(...)` or `<something>.name(...)`. */
function callNamed(callNode: Node, name: string): boolean {
  const fn = callNode.childForFieldName('function');
  if (!fn) return false;
  if (fn.type === 'identifier') return fn.text === name;
  if (fn.type === 'attribute') return fn.childForFieldName('attribute')?.text === name;
  return false;
}

function firstStringArg(callNode: Node): string | null {
  const arg = firstPositionalArg(callNode);
  return arg ? staticString(arg) : null;
}

/**
 * Recognize static file-read expressions and return the literal path:
 *   open("p").read()          → "p"
 *   Path("p").read_text(...)  → "p"   (incl. pathlib.Path)
 * Returns null for anything dynamic or unrecognized.
 */
export function detectFileLoadPath(callNode: Node): string | null {
  const fn = callNode.childForFieldName('function');
  if (!fn || fn.type !== 'attribute') return null;

  const prop = fn.childForFieldName('attribute')?.text;
  const objectNode = fn.childForFieldName('object');
  if (!objectNode || objectNode.type !== 'call') return null;

  if (prop === 'read' && callNamed(objectNode, 'open')) return firstStringArg(objectNode);
  if (prop === 'read_text' && callNamed(objectNode, 'Path')) return firstStringArg(objectNode);
  return null;
}

export interface FileLoadResult {
  ok: boolean;
  /** The literal path as written in source (for display). */
  path: string;
  text?: string;
  reason?: string;
}

/** Read a prompt file relative to the source file's directory, with a size cap. */
export function readPromptFile(rawPath: string, sourceDir: string): FileLoadResult {
  const resolved = path.isAbsolute(rawPath) ? rawPath : path.join(sourceDir, rawPath);
  try {
    const st = statSync(resolved);
    if (st.size > MAX_FILE_BYTES) {
      return { ok: false, path: rawPath, reason: `prompt file too large (${st.size} bytes)` };
    }
    return { ok: true, path: rawPath, text: readFileSync(resolved, 'utf8') };
  } catch {
    return { ok: false, path: rawPath, reason: `prompt file not found: ${rawPath}` };
  }
}
