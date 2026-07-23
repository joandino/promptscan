import { Query, type Node, type Tree, type Language } from 'web-tree-sitter';
import { countTokens } from '../tokens/tokenizer.js';
import type { LangId } from '../parse/lang.js';
import type { DeadPrompt } from '../report/types.js';

/** A string constant must have at least this many words to look like a prompt. */
const DEFAULT_MIN_WORDS = 6;

type Family = 'python' | 'ts';

function family(id: LangId): Family {
  return id === 'python' ? 'python' : 'ts';
}

interface QuerySet {
  names: Query;
  targets: Query;
  strings: Query;
  consts: Query;
}

const CFG: Record<Family, { names: string; targets: string; strings: string; consts: string; scopeBreakers: Set<string> }> = {
  python: {
    names: '(identifier) @id',
    targets: '(assignment left: (identifier) @t)',
    strings: '[(string) (concatenated_string)] @s',
    consts: '(assignment left: (identifier) @name right: [(string) (concatenated_string)] @val) @stmt',
    scopeBreakers: new Set(['function_definition', 'class_definition', 'lambda']),
  },
  ts: {
    names: '[(identifier) (property_identifier) (shorthand_property_identifier)] @id',
    targets: '(variable_declarator name: (identifier) @t)',
    strings: '[(string) (template_string)] @s',
    consts: '(variable_declarator name: (identifier) @name value: [(string) (template_string)] @val) @stmt',
    scopeBreakers: new Set([
      'function_declaration',
      'function_expression',
      'arrow_function',
      'generator_function_declaration',
      'method_definition',
      'class_declaration',
    ]),
  },
};

const cache = new WeakMap<Language, QuerySet>();

function querySet(language: Language, fam: Family): QuerySet {
  const cached = cache.get(language);
  if (cached) return cached;
  const cfg = CFG[fam];
  const qs: QuerySet = {
    names: new Query(language, cfg.names),
    targets: new Query(language, cfg.targets),
    strings: new Query(language, cfg.strings),
    consts: new Query(language, cfg.consts),
  };
  cache.set(language, qs);
  return qs;
}

/** Fully-static text of a string/template subtree, or null if any part is dynamic. */
function staticLiteral(node: Node): string | null {
  if (node.type === 'interpolation' || node.type === 'template_substitution') return null;
  if (node.type === 'string_content' || node.type === 'string_fragment') return node.text;
  let out = '';
  for (const child of node.namedChildren) {
    if (!child) continue;
    const t = staticLiteral(child);
    if (t === null) return null;
    out += t;
  }
  return out;
}

/** True if a definition sits at module top level (no enclosing function/class). */
function isModuleLevel(node: Node, scopeBreakers: Set<string>): boolean {
  let cur: Node | null = node.parent;
  while (cur) {
    if (scopeBreakers.has(cur.type)) return false;
    cur = cur.parent;
  }
  return true;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * True for files that hold test/mock/fixture data rather than shipped source.
 * Constants defined here are expected to be unreferenced, so we don't flag them
 * as dead prompts (references *from* these files still count, though).
 */
export function isTestPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(tests?|__tests__|__mocks__|specs?|fixtures|mocks|e2e)(\/)/.test(p)) return true;
  const base = p.split('/').pop() ?? p;
  if (base === 'conftest.py') return true;
  if (/\.(test|spec|stories)\.[a-z]+$/.test(base)) return true; // foo.test.ts, foo.stories.tsx
  if (/^test_.*\.py$/.test(base) || /_test\.py$/.test(base)) return true; // test_x.py, x_test.py
  if (/^mock/.test(base)) return true; // mock_client.py, mocks.ts
  return false;
}

/** Non-prompt name segments (ASCII art, logos, URLs, error messages, …). */
const NON_PROMPT_SEGMENTS = new Set([
  'ascii', 'art', 'logo', 'banner', 'url', 'uri', 'path', 'regex', 'error', 'errors',
]);

/**
 * Reject constants that are prompt-*shaped* by size but clearly aren't prompts:
 * ASCII art / data blobs (low letter ratio, very long "words") and constants
 * named like logos, URLs, or error messages. Real prompts are instruction prose.
 */
export function looksLikePrompt(text: string, name: string): boolean {
  if (name.split(/[_\s]+/).some((seg) => NON_PROMPT_SEGMENTS.has(seg.toLowerCase()))) return false;
  const nonSpace = text.replace(/\s+/g, '');
  if (nonSpace.length === 0) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters / nonSpace.length < 0.55) return false; // ASCII art / symbol-heavy data
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (nonSpace.length / words.length > 18) return false; // base64 / no real spaces
  return true;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

interface ConstDef {
  file: string;
  line: number;
  name: string;
  text: string;
}

/** Per-file data feeding cross-file dead-prompt analysis. */
export interface DeadPromptFile {
  /** Every name occurrence (identifiers + property accesses). */
  names: Map<string, number>;
  /** Assignment-target occurrences (definitions, not uses). */
  targets: Map<string, number>;
  /** Word-tokens appearing inside string literals (guards dynamic/`__all__` use). */
  stringTokens: Set<string>;
  /** Candidate module-level, static, prompt-shaped string constants. */
  consts: ConstDef[];
}

/** Collect dead-prompt data from one parsed file. */
export function collectDeadPromptFile(
  tree: Tree,
  language: Language,
  langId: LangId,
  relPath: string,
  minWords = DEFAULT_MIN_WORDS,
): DeadPromptFile {
  const fam = family(langId);
  const qs = querySet(language, fam);
  const root = tree.rootNode;

  const names = new Map<string, number>();
  for (const { node } of qs.names.captures(root)) bump(names, node.text);

  const targets = new Map<string, number>();
  for (const { node } of qs.targets.captures(root)) bump(targets, node.text);

  const stringTokens = new Set<string>();
  for (const { node } of qs.strings.captures(root)) {
    for (const tok of node.text.split(/[^A-Za-z0-9_]+/)) if (tok) stringTokens.add(tok);
  }

  // Test/mock/fixture files still contribute references, but their own
  // constants are never candidates (they're expected to be unused).
  const consts: ConstDef[] = [];
  if (!isTestPath(relPath)) {
    for (const match of qs.consts.matches(root)) {
      const name = match.captures.find((c) => c.name === 'name')?.node;
      const val = match.captures.find((c) => c.name === 'val')?.node;
      const stmt = match.captures.find((c) => c.name === 'stmt')?.node;
      if (!name || !val || !stmt) continue;
      if (!isModuleLevel(stmt, CFG[fam].scopeBreakers)) continue;
      const text = staticLiteral(val);
      if (text === null || wordCount(text) < minWords) continue;
      if (!looksLikePrompt(text, name.text)) continue;
      consts.push({ file: relPath, line: name.startPosition.row + 1, name: name.text, text });
    }
  }

  return { names, targets, stringTokens, consts };
}

/**
 * Cross-file dead-prompt analysis. Conservative: a prompt-shaped, module-level,
 * static string constant is reported only when its name is never referenced
 * anywhere (imports and property accesses count as references) and never
 * appears inside a string literal. This is a heuristic — it cannot see runtime
 * reflection, and a library's public prompt consumed by external code will look
 * unused.
 */
export function aggregateDeadPrompts(perFile: DeadPromptFile[]): DeadPrompt[] {
  const names = new Map<string, number>();
  const targets = new Map<string, number>();
  const stringTokens = new Set<string>();
  const consts: ConstDef[] = [];

  for (const f of perFile) {
    for (const [k, v] of f.names) names.set(k, (names.get(k) ?? 0) + v);
    for (const [k, v] of f.targets) targets.set(k, (targets.get(k) ?? 0) + v);
    for (const t of f.stringTokens) stringTokens.add(t);
    consts.push(...f.consts);
  }

  const dead: DeadPrompt[] = [];
  for (const c of consts) {
    const references = (names.get(c.name) ?? 0) - (targets.get(c.name) ?? 0);
    if (references > 0) continue; // referenced/imported/used somewhere
    if (stringTokens.has(c.name)) continue; // guards __all__, getattr, dynamic access
    dead.push({ file: c.file, line: c.line, name: c.name, tokens: countTokens(c.text, 'o200k_base') });
  }

  dead.sort((a, b) => b.tokens - a.tokens || a.file.localeCompare(b.file));
  return dead;
}
