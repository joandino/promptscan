import { Query, type Node, type Tree, type Language } from 'web-tree-sitter';

/**
 * File-scoped symbol table for constant resolution. A name is only trusted
 * when it is assigned exactly once anywhere in the file — that covers both
 * module-level constants and single-use locals while refusing to guess at
 * reassigned variables (which we can't statically order).
 */
export interface SymbolTable {
  /** Name → its single right-hand-side expression node. */
  singles: Map<string, Node>;
  /** Names assigned more than once (or augmented) — deliberately unresolved. */
  ambiguous: Set<string>;
}

const cache = new WeakMap<Language, { plain: Query; augmented: Query }>();

function queries(language: Language) {
  const cached = cache.get(language);
  if (cached) return cached;
  const built = {
    plain: new Query(language, '(assignment left: (identifier) @name right: (_) @rhs)'),
    augmented: new Query(language, '(augmented_assignment left: (identifier) @name)'),
  };
  cache.set(language, built);
  return built;
}

export function buildSymbolTable(tree: Tree, language: Language): SymbolTable {
  const { plain, augmented } = queries(language);
  const singles = new Map<string, Node>();
  const ambiguous = new Set<string>();

  const demote = (name: string) => {
    ambiguous.add(name);
    singles.delete(name);
  };

  for (const match of plain.matches(tree.rootNode)) {
    const name = match.captures.find((c) => c.name === 'name')?.node.text;
    const rhs = match.captures.find((c) => c.name === 'rhs')?.node;
    if (!name || !rhs) continue;
    if (ambiguous.has(name)) continue;
    if (singles.has(name)) {
      demote(name);
    } else {
      singles.set(name, rhs);
    }
  }

  // Any augmented assignment (x += ...) means the name is not a stable constant.
  for (const match of augmented.matches(tree.rootNode)) {
    const name = match.captures.find((c) => c.name === 'name')?.node.text;
    if (name) demote(name);
  }

  return { singles, ambiguous };
}
