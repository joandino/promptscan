import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Parser, Language, type Tree } from 'web-tree-sitter';
import type { LangId } from './lang.js';

const require = createRequire(import.meta.url);

// Re-exported so existing importers keep resolving these from parser.ts.
export { langForExtension, type LangId } from './lang.js';

const WASM: Record<LangId, string> = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  typescript: 'tree-sitter-wasms/out/tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-wasms/out/tree-sitter-tsx.wasm',
};

const languages = new Map<LangId, Language>();
let initialized = false;

/**
 * Initialize the tree-sitter WASM runtime and load every grammar.
 * Idempotent — safe to call more than once. Must be awaited before parsing.
 */
export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  for (const [id, rel] of Object.entries(WASM) as [LangId, string][]) {
    // Resolved from node_modules so it works in both dev (tsx) and dist builds.
    languages.set(id, await Language.load(require.resolve(rel)));
  }
  initialized = true;
}

export function getLanguage(id: LangId): Language {
  const lang = languages.get(id);
  if (!lang) throw new Error(`Parser not initialized for '${id}' — call initParser() first.`);
  return lang;
}

/** Back-compat alias for the Python grammar. */
export function getPythonLanguage(): Language {
  return getLanguage('python');
}

/** Create a parser bound to a loaded grammar. Reusable across files. */
export function createParser(id: LangId): Parser {
  const parser = new Parser();
  parser.setLanguage(getLanguage(id));
  return parser;
}

export type FileParseOutcome =
  | { status: 'clean'; source: string; tree: Tree }
  | { status: 'partial'; source: string; tree: Tree }
  | { status: 'read-error'; message: string };

/**
 * Read and parse a single file with the given parser. tree-sitter is
 * error-tolerant: syntax errors yield a usable tree flagged 'partial' rather
 * than a hard failure. Only an I/O/decode failure produces 'read-error'.
 */
export async function parseFile(parser: Parser, absPath: string): Promise<FileParseOutcome> {
  let source: string;
  try {
    source = await readFile(absPath, 'utf8');
  } catch (err) {
    return { status: 'read-error', message: err instanceof Error ? err.message : String(err) };
  }

  const tree = parser.parse(source);
  if (!tree) {
    return { status: 'read-error', message: 'tree-sitter returned no tree' };
  }

  return {
    status: tree.rootNode.hasError ? 'partial' : 'clean',
    source,
    tree,
  };
}
