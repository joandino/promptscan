import path from 'node:path';
import type { Node, Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';
import { buildModuleContext } from './providers.js';
import { classify, classifyLangChain, classifyLiteLLM, type ArgStyle } from './patterns.js';
import { providerForLiteLLMModel } from './context.js';
import type { Confidence, MatchBasis, Provider } from '../report/types.js';
import type { ResolveContext } from '../resolve/resolver.js';
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
 * Build a call site for a litellm `completion`/`acompletion` call. litellm is a
 * router: the provider is carried in the `model=` string, so we derive it there
 * rather than from an SDK import. Providers we can't natively tokenize/price map
 * to 'other' (still reported). The prompt uses the OpenAI chat message shape.
 */
function litellmSite(
  node: Node,
  method: string,
  receiver: string | null,
  resolveCtx: ResolveContext,
  relPath: string,
): CallSite {
  const { model: rawModel, hint } = extractModel(node);
  let provider: Provider = 'other';
  let model: string | null = null;
  if (rawModel !== null) {
    ({ provider, model } = providerForLiteLLMModel(rawModel));
  }
  const prompt = resolvePrompt(node, 'chat', resolveCtx);
  const tokens = estimateTokens(provider, model, prompt);
  const cost = estimateCost(provider, model, tokens.inputTokens);
  const pos = node.startPosition;
  return {
    file: relPath,
    line: pos.row + 1,
    column: pos.column + 1,
    provider,
    method,
    model,
    modelResolved: model !== null,
    modelHint: hint,
    receiver,
    confidence: 'high',
    basis: 'import',
    prompt,
    tokens,
    cost,
  };
}

/**
 * Detect OpenAI/Anthropic/litellm call sites in a parsed Python module and
 * resolve each prompt. `relPath` is the reported file path; `absPath` is used to
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
  const resolveCtx: ResolveContext = { symbols, sourceDir: path.dirname(absPath) };
  const { attributeCalls, identifierCalls } = getDetectionQueries(language);

  const sites: CallSite[] = [];

  // matches() groups @fn/@call per match; captures() would flatten them in
  // node order (outer @call before inner @fn), which does not pair reliably.
  for (const match of attributeCalls.matches(tree.rootNode)) {
    const fn = match.captures.find((c) => c.name === 'fn')?.node;
    const node = match.captures.find((c) => c.name === 'call')?.node;
    if (!fn || !node) continue;

    const chain = fn.text;
    const receiver = baseIdentifier(fn);

    // Direct SDK call, else a LangChain .invoke/.stream on a bound model, else
    // an attribute-form litellm call (litellm.completion / ll.acompletion).
    const direct = classify(chain, receiver, ctx);
    const lc = direct ? null : classifyLangChain(chain, receiver, ctx);
    const ll = !direct && !lc ? classifyLiteLLM(chain, receiver, ctx) : null;
    if (!direct && !lc && !ll) continue;

    if (ll) {
      sites.push(litellmSite(node, ll, receiver, resolveCtx, relPath));
      continue;
    }

    let provider: Provider;
    let method: string;
    let argStyle: ArgStyle;
    let confidence: Confidence;
    let basis: MatchBasis;
    let model: string | null;
    let hint: string | null;

    if (direct) {
      ({ provider, method, argStyle, confidence, basis } = direct);
      ({ model, hint } = extractModel(node));
    } else {
      provider = lc!.provider;
      method = lc!.method;
      argStyle = 'langchain';
      confidence = 'high';
      basis = 'binding';
      model = lc!.model; // resolved at the LangChain constructor
      hint = null;
    }

    const prompt = resolvePrompt(node, argStyle, resolveCtx);
    const tokens = estimateTokens(provider, model, prompt);
    const cost = estimateCost(provider, model, tokens.inputTokens);
    const pos = node.startPosition;
    sites.push({
      file: relPath,
      line: pos.row + 1,
      column: pos.column + 1,
      provider,
      method,
      model,
      modelResolved: model !== null,
      modelHint: hint,
      receiver,
      confidence,
      basis,
      prompt,
      tokens,
      cost,
    });
  }

  // Bare `completion(...)` / `acompletion(...)` from `from litellm import …`.
  // Only fires when the identifier is bound to a litellm entrypoint.
  if (ctx.litellmFns.size > 0) {
    for (const match of identifierCalls.matches(tree.rootNode)) {
      const fn = match.captures.find((c) => c.name === 'fn')?.node;
      const node = match.captures.find((c) => c.name === 'call')?.node;
      if (!fn || !node) continue;
      const canonical = ctx.litellmFns.get(fn.text);
      if (!canonical) continue;
      sites.push(litellmSite(node, `litellm.${canonical}`, null, resolveCtx, relPath));
    }
  }

  return sites;
}
