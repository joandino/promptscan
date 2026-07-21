import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { Parser, Language, type Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

let pythonLanguage: Language | null = null;
let initialized = false;

/**
 * Initialize the tree-sitter WASM runtime and load the Python grammar.
 * Idempotent — safe to call more than once. Must be awaited before parsing.
 */
export async function initParser(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  // Resolved from node_modules so it works in both dev (tsx) and dist builds.
  const wasmPath = require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm');
  pythonLanguage = await Language.load(wasmPath);
  initialized = true;
}

export function getPythonLanguage(): Language {
  if (!pythonLanguage) {
    throw new Error('Parser not initialized — call initParser() before parsing.');
  }
  return pythonLanguage;
}

/**
 * Create a Python parser bound to the loaded grammar. A single instance can be
 * reused across many files; call parse() per file.
 */
export function createPythonParser(): Parser {
  const parser = new Parser();
  parser.setLanguage(getPythonLanguage());
  return parser;
}

export type FileParseOutcome =
  | { status: 'clean'; source: string; tree: Tree }
  | { status: 'partial'; source: string; tree: Tree }
  | { status: 'read-error'; message: string };

/**
 * Read and parse a single Python file. tree-sitter is error-tolerant: syntax
 * errors yield a usable tree flagged as 'partial' rather than a hard failure.
 * Only an I/O/decode failure produces 'read-error'.
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
