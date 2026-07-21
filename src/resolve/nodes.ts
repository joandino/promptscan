import type { Node } from 'web-tree-sitter';

/** The first positional (non-keyword) argument of a call, if any. */
export function firstPositionalArg(callNode: Node): Node | null {
  const args = callNode.childForFieldName('arguments');
  if (!args) return null;
  for (const child of args.namedChildren) {
    if (child && child.type !== 'keyword_argument') return child;
  }
  return null;
}

/** The value node of a `name=` keyword argument on a call, if present. */
export function keywordArgValue(callNode: Node, name: string): Node | null {
  const args = callNode.childForFieldName('arguments');
  if (!args) return null;
  for (const child of args.namedChildren) {
    if (child?.type === 'keyword_argument' && child.childForFieldName('name')?.text === name) {
      return child.childForFieldName('value') ?? null;
    }
  }
  return null;
}

/**
 * Fully-static text of a string (or concatenated-string) node, or null if any
 * part is dynamic (f-string interpolation) or the node is not a string.
 */
export function staticString(node: Node): string | null {
  if (node.type === 'string') {
    if (node.namedChildren.some((c) => c?.type === 'interpolation')) return null;
    return node.namedChildren
      .filter((c): c is Node => !!c && c.type === 'string_content')
      .map((c) => c.text)
      .join('');
  }
  if (node.type === 'concatenated_string') {
    let out = '';
    for (const child of node.namedChildren) {
      if (!child) continue;
      const s = staticString(child);
      if (s === null) return null;
      out += s;
    }
    return out;
  }
  return null;
}
