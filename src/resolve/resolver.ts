import type { Node } from 'web-tree-sitter';
import type { SymbolTable } from './symbols.js';
import type {
  ResolvedValue,
  ResolutionSource,
  PromptSegment,
  PromptPart,
  PromptOrigin,
  ResolvedPrompt,
} from '../report/types.js';
import { keywordArgValue, staticString, firstPositionalArg } from './nodes.js';
import { detectFileLoadPath, readPromptFile } from './fileload.js';
import { messageRole } from '../detect/context.js';
import type { ArgStyle } from '../detect/patterns.js';
import type { ImportBinding, ModuleImportMaps, ModuleScope } from './modules.js';
import { enclosingClassStart } from './selfattrs.js';

export interface ResolveContext {
  symbols: SymbolTable;
  /** Directory of the source file, for resolving relative prompt-file paths. */
  sourceDir: string;
  /** Cross-module import bindings (from `from x import NAME` / `import x`). */
  imports?: ModuleImportMaps;
  /** Resolve an import spec to another in-scan module's scope, or null if external. */
  loadModule?: (spec: string, fromDir: string) => ModuleScope | null;
  /** Absolute path identifying this scope, for cross-module cycle detection. */
  scopeId?: string;
  /** Per-class `self.NAME = <expr>` tables (Python), keyed by class start byte. */
  selfAttrs?: Map<number, SymbolTable>;
}

const MAX_DEPTH = 16;
const LABEL_MAX = 48;

function label(node: Node): string {
  const t = node.text.replace(/\s+/g, ' ').trim();
  return t.length > LABEL_MAX ? t.slice(0, LABEL_MAX - 1) + '…' : t;
}

function makeResolved(text: string, source: ResolutionSource): ResolvedValue {
  return { status: 'resolved', text, segments: [{ kind: 'static', text }], source };
}

function makeUnresolved(labelText: string, reason: string, source: ResolutionSource): ResolvedValue {
  return { status: 'unresolved', text: '', segments: [{ kind: 'dynamic', text: labelText }], source, reason };
}

/** Merge sub-values (e.g. the operands of `+`, or content blocks). */
function combine(values: ResolvedValue[], source: ResolutionSource): ResolvedValue {
  const segments: PromptSegment[] = values.flatMap((v) => v.segments);
  const text = segments.filter((s) => s.kind === 'static').map((s) => s.text).join('');
  const allResolved = values.every((v) => v.status === 'resolved');
  const allUnresolved = values.every((v) => v.status === 'unresolved');
  const reason = values.find((v) => v.status !== 'resolved')?.reason;

  if (allResolved) return { status: 'resolved', text, segments, source };
  if (allUnresolved) return { status: 'unresolved', text, segments, source, reason };
  return { status: 'partial', text, segments, source, reason: reason ?? 'contains runtime values' };
}

function resolveStringNode(node: Node): ResolvedValue {
  const segments: PromptSegment[] = [];
  let dynamic = false;
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === 'string_content') {
      segments.push({ kind: 'static', text: child.text });
    } else if (child.type === 'interpolation') {
      dynamic = true;
      const inner = child.namedChildren.find(Boolean);
      segments.push({ kind: 'dynamic', text: inner ? inner.text : child.text });
    }
  }
  const text = segments.filter((s) => s.kind === 'static').map((s) => s.text).join('');
  return dynamic
    ? { status: 'partial', text, segments, source: 'fstring', reason: 'contains runtime interpolation' }
    : { status: 'resolved', text, segments, source: 'literal' };
}

/** Scope-qualified visited key so the same name in two files doesn't collide. */
function scopeKey(ctx: ResolveContext, name: string): string {
  return `${ctx.scopeId ?? ctx.sourceDir}#${name}`;
}

function resolveName(node: Node, ctx: ResolveContext, visited: Set<string>, depth: number): ResolvedValue {
  return resolveNameCore(node.text, ctx, visited, depth);
}

/** Resolve a bare name in a scope: local constant, else a followed cross-module import. */
function resolveNameCore(name: string, ctx: ResolveContext, visited: Set<string>, depth: number): ResolvedValue {
  const key = scopeKey(ctx, name);
  if (visited.has(key)) return makeUnresolved(name, `circular reference to '${name}'`, 'const');
  if (ctx.symbols.ambiguous.has(name)) {
    return makeUnresolved(name, `'${name}' is reassigned — not a stable constant`, 'const');
  }
  const next = new Set(visited).add(key);
  const rhs = ctx.symbols.singles.get(name);
  if (rhs) return resolveExpr(rhs, ctx, next, depth + 1);
  const imported = ctx.imports?.named.get(name);
  if (imported && ctx.loadModule) return resolveImported(imported, ctx, next, depth + 1);
  return makeUnresolved(name, `'${name}' not statically resolvable (parameter, import, or runtime value)`, 'const');
}

/** Follow an import binding into another in-scan module and resolve the exported name there. */
function resolveImported(binding: ImportBinding, ctx: ResolveContext, visited: Set<string>, depth: number): ResolvedValue {
  if (depth > MAX_DEPTH) return makeUnresolved(binding.name, 'resolution depth exceeded', 'const');
  const scope = ctx.loadModule?.(binding.module, ctx.sourceDir);
  if (!scope) {
    return makeUnresolved(
      binding.name,
      `imported from '${binding.module}' — module not found in scan (external package or unresolved path)`,
      'const',
    );
  }
  const childCtx: ResolveContext = {
    symbols: scope.symbols,
    sourceDir: scope.sourceDir,
    imports: scope.imports,
    loadModule: ctx.loadModule,
    scopeId: scope.absPath,
  };
  return resolveNameCore(binding.name, childCtx, visited, depth + 1);
}

/** Resolve `self.NAME` against the enclosing class's single-assignment attribute table. */
function resolveSelfAttr(
  name: string,
  classStart: number,
  table: SymbolTable,
  ctx: ResolveContext,
  visited: Set<string>,
  depth: number,
): ResolvedValue {
  const key = `self@${classStart}#${name}`;
  if (visited.has(key)) return makeUnresolved(`self.${name}`, `circular self-attribute '${name}'`, 'const');
  if (table.ambiguous.has(name)) {
    return makeUnresolved(`self.${name}`, `'self.${name}' is assigned more than once — not a stable value`, 'const');
  }
  const rhs = table.singles.get(name);
  if (!rhs) {
    return makeUnresolved(`self.${name}`, `'self.${name}' is not set to a static value in the class`, 'const');
  }
  return resolveExpr(rhs, ctx, new Set(visited).add(key), depth + 1);
}

function resolveCall(node: Node, ctx: ResolveContext): ResolvedValue {
  const filePath = detectFileLoadPath(node);
  if (filePath !== null) {
    const result = readPromptFile(filePath, ctx.sourceDir);
    return result.ok
      ? makeResolved(result.text ?? '', 'file')
      : makeUnresolved(filePath, result.reason ?? 'file read failed', 'file');
  }
  const fn = node.childForFieldName('function');
  return makeUnresolved(label(node), `value from function call${fn ? ` (${label(fn)})` : ''}`, 'unknown');
}

/** Resolve an arbitrary expression to a (possibly partial) prompt value. */
export function resolveExpr(
  node: Node,
  ctx: ResolveContext,
  visited: Set<string> = new Set(),
  depth = 0,
): ResolvedValue {
  if (depth > MAX_DEPTH) return makeUnresolved(label(node), 'resolution depth exceeded', 'unknown');

  switch (node.type) {
    case 'string':
      return resolveStringNode(node);
    case 'concatenated_string':
      return combine(
        node.namedChildren.filter((c): c is Node => !!c).map((c) => resolveExpr(c, ctx, visited, depth + 1)),
        'concat',
      );
    case 'binary_operator': {
      const op = node.childForFieldName('operator')?.text;
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op !== '+' || !left || !right) {
        return makeUnresolved(label(node), `unsupported operator '${op ?? '?'}'`, 'concat');
      }
      return combine(
        [resolveExpr(left, ctx, visited, depth + 1), resolveExpr(right, ctx, visited, depth + 1)],
        'concat',
      );
    }
    case 'parenthesized_expression': {
      const inner = node.namedChildren.find(Boolean);
      return inner ? resolveExpr(inner, ctx, visited, depth + 1) : makeUnresolved('()', 'empty expression', 'unknown');
    }
    case 'identifier':
      return resolveName(node, ctx, visited, depth);
    case 'call':
      return resolveCall(node, ctx);
    case 'attribute': {
      const obj = node.childForFieldName('object');
      const prop = node.childForFieldName('attribute')?.text;
      if (obj?.type === 'identifier' && prop) {
        // `self.NAME` → resolve against the enclosing class's attribute table.
        if (obj.text === 'self' && ctx.selfAttrs) {
          const cls = enclosingClassStart(node);
          const table = cls !== null ? ctx.selfAttrs.get(cls) : undefined;
          if (table) return resolveSelfAttr(prop, cls as number, table, ctx, visited, depth);
        }
        // `module.NAME` where module was imported (`import prompts`) → follow it.
        if (ctx.imports && ctx.loadModule) {
          const modSpec = ctx.imports.modules.get(obj.text);
          if (modSpec) return resolveImported({ module: modSpec, name: prop }, ctx, visited, depth + 1);
        }
      }
      return makeUnresolved(label(node), `attribute access not resolved (${label(node)})`, 'unknown');
    }
    default:
      return makeUnresolved(label(node), `unsupported expression (${node.type})`, 'unknown');
  }
}

// ---- Prompt extraction from a call site -----------------------------------

function pairValue(dict: Node, key: string): Node | null {
  for (const pair of dict.namedChildren) {
    if (pair?.type !== 'pair') continue;
    const k = pair.childForFieldName('key');
    if (k && staticString(k) === key) return pair.childForFieldName('value');
  }
  return null;
}

/** Follow a name to a list literal if it resolves to one; else return the node if it is a list. */
function asListLiteral(node: Node, ctx: ResolveContext, visited = new Set<string>()): Node | null {
  if (node.type === 'list') return node;
  if (node.type === 'identifier' && !visited.has(node.text)) {
    const rhs = ctx.symbols.singles.get(node.text);
    if (rhs) return asListLiteral(rhs, ctx, new Set(visited).add(node.text));
  }
  return null;
}

/** Follow a name to a dict literal if it resolves to one; else the node if it is a dict. */
function asDictLiteral(node: Node, ctx: ResolveContext, visited = new Set<string>()): Node | null {
  if (node.type === 'dictionary') return node;
  if (node.type === 'identifier' && !visited.has(node.text)) {
    const rhs = ctx.symbols.singles.get(node.text);
    if (rhs) return asDictLiteral(rhs, ctx, new Set(visited).add(node.text));
  }
  return null;
}

/**
 * Value for `name` inside a `**kwargs` dictionary spread on a call, if the
 * spread expression resolves to a static dict literal — e.g.
 * `params = {"model": "gpt-4o", "messages": [...]}; create(**params)`.
 */
export function splatDictValue(callNode: Node, name: string, ctx: ResolveContext): Node | null {
  const args = callNode.childForFieldName('arguments');
  if (!args) return null;
  for (const child of args.namedChildren) {
    if (child?.type !== 'dictionary_splat') continue;
    const expr = child.namedChildren.find((c): c is Node => !!c);
    const dict = expr ? asDictLiteral(expr, ctx) : null;
    const value = dict ? pairValue(dict, name) : null;
    if (value) return value;
  }
  return null;
}

/** A call's `name=` keyword argument, falling back to `**kwargs` dict spread. */
function argValue(callNode: Node, name: string, ctx: ResolveContext): Node | null {
  return keywordArgValue(callNode, name) ?? splatDictValue(callNode, name, ctx);
}

/** A resolved content value plus whether it carries a cache breakpoint. */
interface ContentResult {
  value: ResolvedValue;
  cached: boolean;
}

/** True when a content-block dict carries an Anthropic `cache_control` key. */
function hasCacheControl(dict: Node): boolean {
  return pairValue(dict, 'cache_control') !== null;
}

/**
 * Resolve a `content` value that may be a string or a list of text blocks, and
 * report whether any block carries a `cache_control` breakpoint. The list may be
 * a literal or a name bound to one, so an extracted block list still resolves.
 */
function resolveContent(node: Node, ctx: ResolveContext): ContentResult {
  const list = asListLiteral(node, ctx);
  if (list) {
    const blocks: ResolvedValue[] = [];
    let cached = false;
    for (const block of list.namedChildren) {
      if (block?.type === 'dictionary') {
        if (hasCacheControl(block)) cached = true;
        const textVal = pairValue(block, 'text');
        blocks.push(
          textVal
            ? resolveExpr(textVal, ctx)
            : makeUnresolved(label(block), 'content block without a text field', 'unknown'),
        );
      } else if (block) {
        blocks.push(makeUnresolved(label(block), 'non-dict content block', 'unknown'));
      }
    }
    if (blocks.length === 0) return { value: makeUnresolved('[]', 'empty content list', 'unknown'), cached };
    return { value: combine(blocks, 'concat'), cached };
  }
  return { value: resolveExpr(node, ctx), cached: false };
}

function resolveMessagesArg(node: Node, ctx: ResolveContext, origin: PromptOrigin): PromptPart[] {
  const list = asListLiteral(node, ctx);
  if (!list) {
    return [{ role: null, origin, value: makeUnresolved(label(node), 'messages is not a static list', 'unknown'), cacheControl: false }];
  }

  const parts: PromptPart[] = [];
  for (const element of list.namedChildren) {
    if (element?.type !== 'dictionary') {
      if (element) {
        parts.push({ role: null, origin, value: makeUnresolved(label(element), 'message is not a literal dict', 'unknown'), cacheControl: false });
      }
      continue;
    }
    const roleNode = pairValue(element, 'role');
    const role = roleNode ? staticString(roleNode) : null;
    const contentNode = pairValue(element, 'content');
    const content = contentNode
      ? resolveContent(contentNode, ctx)
      : { value: makeUnresolved(label(element), 'message has no content field', 'unknown'), cached: false };
    parts.push({ role, origin, value: content.value, cacheControl: content.cached });
  }
  return parts;
}

function scalarPart(node: Node, ctx: ResolveContext, origin: PromptOrigin, role: string | null): PromptPart {
  const content = resolveContent(node, ctx);
  return { role, origin, value: content.value, cacheControl: content.cached };
}

function aggregate(parts: PromptPart[]): ResolvedPrompt {
  if (parts.length === 0) {
    return { status: 'unresolved', parts, reason: 'no prompt argument found' };
  }
  const statuses = parts.map((p) => p.value.status);
  if (statuses.every((s) => s === 'resolved')) return { status: 'resolved', parts };
  const firstReason = parts.find((p) => p.value.status !== 'resolved')?.value.reason;
  if (statuses.every((s) => s === 'unresolved')) {
    return { status: 'unresolved', parts, reason: firstReason };
  }
  return { status: 'partial', parts, reason: firstReason };
}

/** Extract and resolve the prompt content for a detected call site. */
export function resolvePrompt(
  callNode: Node,
  argStyle: ArgStyle,
  ctx: ResolveContext,
): ResolvedPrompt {
  const parts: PromptPart[] = [];

  if (argStyle === 'chat') {
    const messages = argValue(callNode, 'messages', ctx);
    if (messages) parts.push(...resolveMessagesArg(messages, ctx, 'messages'));
  } else if (argStyle === 'messages') {
    const system = argValue(callNode, 'system', ctx);
    if (system) parts.push(scalarPart(system, ctx, 'system', 'system'));
    const messages = argValue(callNode, 'messages', ctx);
    if (messages) parts.push(...resolveMessagesArg(messages, ctx, 'messages'));
  } else if (argStyle === 'responses') {
    const instructions = argValue(callNode, 'instructions', ctx);
    if (instructions) parts.push(scalarPart(instructions, ctx, 'instructions', 'system'));
    const input = argValue(callNode, 'input', ctx);
    if (input) {
      const list = asListLiteral(input, ctx);
      if (list) parts.push(...resolveMessagesArg(input, ctx, 'input'));
      else parts.push(scalarPart(input, ctx, 'input', null));
    }
  } else if (argStyle === 'langchain') {
    parts.push(...resolveLangChainInput(callNode, ctx));
  }

  // Automatic caching: a single top-level `cache_control=` on the request lets
  // the API manage breakpoints, which caches the whole stable prefix. Marking
  // the last part is equivalent under the "up to and including" prefix rule.
  if (parts.length > 0 && argValue(callNode, 'cache_control', ctx)) {
    parts[parts.length - 1]!.cacheControl = true;
  }

  return aggregate(parts);
}

/** Content of a LangChain message element: `HumanMessage("..")` / `("system", "..")`. */
function resolveLangChainElement(el: Node, ctx: ResolveContext): PromptPart {
  if (el.type === 'call') {
    const ctorName = el.childForFieldName('function')?.text ?? '';
    const role = messageRole(ctorName);
    const content = keywordArgValue(el, 'content') ?? firstPositionalArg(el);
    return { role, origin: 'input', value: content ? resolveExpr(content, ctx) : makeUnresolved(label(el), 'message without content', 'unknown'), cacheControl: false };
  }
  if (el.type === 'tuple') {
    const items = el.namedChildren.filter((c): c is Node => !!c);
    const role = items[0] ? staticString(items[0]) : null;
    return { role, origin: 'input', value: items[1] ? resolveExpr(items[1], ctx) : makeUnresolved(label(el), 'empty message tuple', 'unknown'), cacheControl: false };
  }
  return { role: null, origin: 'input', value: makeUnresolved(label(el), 'unsupported message element', 'unknown'), cacheControl: false };
}

/** Resolve the first positional argument of a LangChain `.invoke(...)`. */
function resolveLangChainInput(callNode: Node, ctx: ResolveContext): PromptPart[] {
  const arg = firstPositionalArg(callNode);
  if (!arg) return [{ role: null, origin: 'input', value: makeUnresolved('', 'no prompt argument', 'unknown'), cacheControl: false }];

  const list = asListLiteral(arg, ctx);
  if (list) {
    const els = list.namedChildren.filter((c): c is Node => !!c);
    return els.length > 0
      ? els.map((el) => resolveLangChainElement(el, ctx))
      : [{ role: null, origin: 'input', value: makeUnresolved('[]', 'empty message list', 'unknown'), cacheControl: false }];
  }
  if (arg.type === 'string' || arg.type === 'concatenated_string' || arg.type === 'identifier') {
    return [{ role: null, origin: 'input', value: resolveExpr(arg, ctx), cacheControl: false }];
  }
  // dict / template / chain input — the prompt is usually in a template.
  return [{ role: null, origin: 'input', value: makeUnresolved(label(arg), 'LangChain input (prompt may be defined in a template)', 'unknown'), cacheControl: false }];
}
