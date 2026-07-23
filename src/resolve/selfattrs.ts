import { Query, type Node, type Tree, type Language } from 'web-tree-sitter';
import type { SymbolTable } from './symbols.js';

const cache = new WeakMap<Language, { plain: Query; aug: Query }>();

function queries(language: Language): { plain: Query; aug: Query } {
  const cached = cache.get(language);
  if (cached) return cached;
  const built = {
    plain: new Query(language, '(assignment left: (attribute) @lhs right: (_) @rhs) @stmt'),
    aug: new Query(language, '(augmented_assignment left: (attribute) @lhs) @stmt'),
  };
  cache.set(language, built);
  return built;
}

/** If `node` is a `self.NAME` attribute, return NAME; else null. */
function selfAttrName(node: Node): string | null {
  if (node.type !== 'attribute') return null;
  const obj = node.childForFieldName('object');
  if (obj?.type !== 'identifier' || obj.text !== 'self') return null;
  return node.childForFieldName('attribute')?.text ?? null;
}

/** Start byte of the nearest enclosing class_definition, or null if not in a class. */
export function enclosingClassStart(node: Node): number | null {
  let cur: Node | null = node.parent;
  while (cur) {
    if (cur.type === 'class_definition') return cur.startIndex;
    cur = cur.parent;
  }
  return null;
}

/**
 * Per-class table of `self.NAME = <expr>` single assignments (Python), keyed by
 * the class's start byte. An attribute assigned more than once (or augmented) is
 * demoted to ambiguous — the same single-assignment rule as the module symbol
 * table, so `self.system = SUPPORT_PROMPT` in `__init__` resolves at the call
 * site but a reassigned attribute is left honestly unresolved.
 */
export function buildSelfAttrs(tree: Tree, language: Language): Map<number, SymbolTable> {
  const { plain, aug } = queries(language);
  const byClass = new Map<number, SymbolTable>();
  const tableFor = (cls: number): SymbolTable => {
    let t = byClass.get(cls);
    if (!t) {
      t = { singles: new Map(), ambiguous: new Set() };
      byClass.set(cls, t);
    }
    return t;
  };

  for (const match of plain.matches(tree.rootNode)) {
    const lhs = match.captures.find((c) => c.name === 'lhs')?.node;
    const rhs = match.captures.find((c) => c.name === 'rhs')?.node;
    const stmt = match.captures.find((c) => c.name === 'stmt')?.node;
    if (!lhs || !rhs || !stmt) continue;
    const attr = selfAttrName(lhs);
    const cls = attr ? enclosingClassStart(stmt) : null;
    if (!attr || cls === null) continue;
    const t = tableFor(cls);
    if (t.ambiguous.has(attr)) continue;
    if (t.singles.has(attr)) {
      t.ambiguous.add(attr);
      t.singles.delete(attr);
    } else {
      t.singles.set(attr, rhs);
    }
  }

  for (const match of aug.matches(tree.rootNode)) {
    const lhs = match.captures.find((c) => c.name === 'lhs')?.node;
    const stmt = match.captures.find((c) => c.name === 'stmt')?.node;
    if (!lhs || !stmt) continue;
    const attr = selfAttrName(lhs);
    const cls = attr ? enclosingClassStart(stmt) : null;
    if (!attr || cls === null) continue;
    const t = tableFor(cls);
    t.ambiguous.add(attr);
    t.singles.delete(attr);
  }

  return byClass;
}
