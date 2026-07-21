import path from 'node:path';
import type { Node, Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';
import { buildModuleContext } from './providers.js';
import { classify } from './patterns.js';
import { buildSymbolTable } from '../resolve/symbols.js';
import { resolvePrompt } from '../resolve/resolver.js';
import { estimateTokens } from '../tokens/tokenizer.js';
import { estimateCost } from '../pricing/cost.js';
import type { CallSite } from '../report/types.js';

/** Walk an attribute chain down to its base identifier, if it is a plain name. */
function baseIdentifier(attrNode: Node): string | null {
  let cur: Node | null = attrNode;
  while (cur && cur.type === 'attribute') {
    cur = cur.childForFieldName('object');
  }
  return cur && cur.type === 'identifier' ? cur.text : null;
}

/** Extract a static string value from a Python `string` node, if fully static. */
function staticStringValue(node: Node): string | null {
  if (node.type !== 'string') return null;
  // f-strings surface `interpolation` children — not statically known.
  if (node.namedChildren.some((c) => c?.type === 'interpolation')) return null;
  const parts = node.namedChildren
    .filter((c): c is Node => !!c && c.type === 'string_content')
    .map((c) => c.text);
  return parts.join('');
}

/** Find the `model=` keyword argument and resolve it if it is a literal. */
function extractModel(callNode: Node): { model: string | null; hint: string | null } {
  const args = callNode.childForFieldName('arguments');
  if (!args) return { model: null, hint: null };
  for (const child of args.namedChildren) {
    if (child?.type !== 'keyword_argument') continue;
    if (child.childForFieldName('name')?.text !== 'model') continue;
    const value = child.childForFieldName('value');
    if (!value) return { model: null, hint: null };
    const literal = staticStringValue(value);
    if (literal !== null) return { model: literal, hint: null };
    // Dynamic model (variable/constant/f-string) — resolved in a later phase.
    return { model: null, hint: value.text };
  }
  return { model: null, hint: null };
}

/**
 * Detect OpenAI/Anthropic call sites in a parsed Python module and resolve
 * each prompt. `relPath` is the reported file path; `absPath` is used to
 * resolve relative prompt-file loads.
 */
export function detectCallSites(
  tree: Tree,
  language: Language,
  relPath: string,
  absPath: string,
): CallSite[] {
  const ctx = buildModuleContext(tree, language);
  const symbols = buildSymbolTable(tree, language);
  const resolveCtx = { symbols, sourceDir: path.dirname(absPath) };
  const { attributeCalls } = getDetectionQueries(language);

  const sites: CallSite[] = [];

  // matches() groups @fn/@call per match; captures() would flatten them in
  // node order (outer @call before inner @fn), which does not pair reliably.
  for (const match of attributeCalls.matches(tree.rootNode)) {
    const fn = match.captures.find((c) => c.name === 'fn')?.node;
    const node = match.captures.find((c) => c.name === 'call')?.node;
    if (!fn || !node) continue;

    const chain = fn.text;
    const receiver = baseIdentifier(fn);
    const result = classify(chain, receiver, ctx);
    if (!result) continue;

    const { model, hint } = extractModel(node);
    const prompt = resolvePrompt(node, result.argStyle, resolveCtx);
    const tokens = estimateTokens(result.provider, model, prompt);
    const cost = estimateCost(result.provider, model, tokens.inputTokens);
    const pos = node.startPosition;
    sites.push({
      file: relPath,
      line: pos.row + 1,
      column: pos.column + 1,
      provider: result.provider,
      method: result.method,
      model,
      modelResolved: model !== null,
      modelHint: hint,
      receiver,
      confidence: result.confidence,
      basis: result.basis,
      prompt,
      tokens,
      cost,
    });
  }

  return sites;
}
