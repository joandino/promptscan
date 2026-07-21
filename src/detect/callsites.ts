import path from 'node:path';
import type { Node, Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';
import { buildModuleContext, type ModuleContext, type Provider } from './providers.js';
import { buildSymbolTable } from '../resolve/symbols.js';
import { resolvePrompt, type ArgStyle } from '../resolve/resolver.js';
import { estimateTokens } from '../tokens/tokenizer.js';
import type { CallSite, Confidence, MatchBasis } from '../report/types.js';

interface MethodPattern {
  suffix: string;
  provider: Provider;
  method: string;
  /** Which argument shape carries the prompt (create/parse/stream share one). */
  argStyle: ArgStyle;
  /** Long, self-identifying chains need no import/binding corroboration. */
  selfIdentifying: boolean;
}

/**
 * Attribute-chain suffixes we treat as LLM calls. create/parse/stream all take
 * the same prompt arguments. Long chat.completions chains are self-identifying;
 * the short responses and messages chains are gated (see classify) because e.g.
 * `client.messages.create` / `.stream` is also Twilio's SMS API.
 */
const METHOD_PATTERNS: MethodPattern[] = [
  { suffix: '.chat.completions.create', provider: 'openai', method: 'chat.completions.create', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.chat.completions.parse', provider: 'openai', method: 'chat.completions.parse', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.chat.completions.stream', provider: 'openai', method: 'chat.completions.stream', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.responses.create', provider: 'openai', method: 'responses.create', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.responses.parse', provider: 'openai', method: 'responses.parse', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.responses.stream', provider: 'openai', method: 'responses.stream', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.messages.create', provider: 'anthropic', method: 'messages.create', argStyle: 'messages', selfIdentifying: false },
  { suffix: '.messages.stream', provider: 'anthropic', method: 'messages.stream', argStyle: 'messages', selfIdentifying: false },
];

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

interface Classification {
  provider: Provider;
  method: string;
  argStyle: ArgStyle;
  confidence: Confidence;
  basis: MatchBasis;
}

function classify(chain: string, receiver: string | null, ctx: ModuleContext): Classification | null {
  const pattern = METHOD_PATTERNS.find((p) => chain.endsWith(p.suffix));
  if (!pattern) return null;

  const base = { provider: pattern.provider, method: pattern.method, argStyle: pattern.argStyle };
  const bound = receiver ? ctx.clientVars.get(receiver) : undefined;

  // A variable bound to a different provider than the shape implies is a
  // contradiction — skip rather than emit a likely false positive.
  if (bound && bound !== pattern.provider) {
    return pattern.selfIdentifying ? { ...base, confidence: 'high', basis: 'shape' } : null;
  }

  if (bound === pattern.provider) {
    return { ...base, confidence: 'high', basis: 'binding' };
  }

  if (pattern.selfIdentifying) {
    const basis: MatchBasis = ctx.importedProviders.has(pattern.provider) ? 'import' : 'shape';
    return { ...base, confidence: 'high', basis };
  }

  // Short, ambiguous chain with no binding: require the SDK import to corroborate.
  if (ctx.importedProviders.has(pattern.provider)) {
    return { ...base, confidence: 'medium', basis: 'import' };
  }

  return null;
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
    });
  }

  return sites;
}
