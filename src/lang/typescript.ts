import path from 'node:path';
import { Query, type Node, type Tree, type Language } from 'web-tree-sitter';
import {
  ctorSet,
  providerForModule,
  emptyModuleContext,
  langChainProvider,
  isLangChainModule,
  messageRole,
  type ModuleContext,
  type Provider,
} from '../detect/context.js';
import { classify, classifyLangChain, type ArgStyle } from '../detect/patterns.js';
import type { Confidence, MatchBasis } from '../report/types.js';
import type { SymbolTable } from '../resolve/symbols.js';
import { readPromptFile } from '../resolve/fileload.js';
import { estimateTokens } from '../tokens/tokenizer.js';
import { estimateCost } from '../pricing/cost.js';
import type {
  CallSite,
  PromptOrigin,
  PromptPart,
  PromptSegment,
  ResolvedPrompt,
  ResolutionSource,
  ResolvedValue,
} from '../report/types.js';

// ---- query cache -----------------------------------------------------------

interface TsQueries {
  calls: Query;
  imports: Query;
  declarators: Query;
  reassigns: Query;
}
const queryCache = new WeakMap<Language, TsQueries>();

function queries(language: Language): TsQueries {
  const cached = queryCache.get(language);
  if (cached) return cached;
  const built: TsQueries = {
    calls: new Query(language, '(call_expression function: (member_expression) @fn) @call'),
    imports: new Query(language, '(import_statement) @imp'),
    declarators: new Query(language, '(variable_declarator) @decl'),
    reassigns: new Query(
      language,
      '[(assignment_expression left: (identifier) @name) (augmented_assignment_expression left: (identifier) @name)]',
    ),
  };
  queryCache.set(language, built);
  return built;
}

// ---- small node helpers ----------------------------------------------------

const named = (node: Node): Node[] => node.namedChildren.filter((c): c is Node => !!c);

/** Base identifier of a member chain (`a.b.c` → `a`), or null if not a plain name. */
function baseIdentifier(memberNode: Node): string | null {
  let cur: Node | null = memberNode;
  while (cur && cur.type === 'member_expression') cur = cur.childForFieldName('object');
  return cur && cur.type === 'identifier' ? cur.text : null;
}

/** Fully-static text of a string / non-interpolated template, else null. */
function tsStatic(node: Node): string | null {
  if (node.type === 'string') {
    return named(node)
      .filter((c) => c.type === 'string_fragment' || c.type === 'escape_sequence')
      .map((c) => c.text)
      .join('');
  }
  if (node.type === 'template_string') {
    if (named(node).some((c) => c.type === 'template_substitution')) return null;
    return named(node)
      .filter((c) => c.type === 'string_fragment' || c.type === 'escape_sequence')
      .map((c) => c.text)
      .join('');
  }
  return null;
}

/** Property key name from an object `pair` key node. */
function keyName(key: Node | null): string | null {
  if (!key) return null;
  if (key.type === 'property_identifier') return key.text;
  return tsStatic(key);
}

/** The object literal that is the first argument of a call, if any. */
function firstArgObject(callNode: Node): Node | null {
  const args = callNode.childForFieldName('arguments');
  if (!args) return null;
  return named(args).find((c) => c.type === 'object') ?? null;
}

/** Value of a `name:` property in the call's first-argument object literal. */
function keywordArgValue(callNode: Node, name: string): Node | null {
  const obj = firstArgObject(callNode);
  if (!obj) return null;
  for (const pair of named(obj)) {
    if (pair.type !== 'pair') continue;
    if (keyName(pair.childForFieldName('key')) === name) return pair.childForFieldName('value');
  }
  return null;
}

// ---- module context (imports + client bindings) ----------------------------

function isRequireCall(node: Node): string | null {
  if (node.type !== 'call_expression') return null;
  if (node.childForFieldName('function')?.text !== 'require') return null;
  const arg = node.childForFieldName('arguments');
  const str = arg && named(arg).find((c) => c.type === 'string');
  return str ? tsStatic(str) : null;
}

function collectImports(tree: Tree, language: Language, ctx: ModuleContext): void {
  for (const { node } of queries(language).imports.captures(tree.rootNode)) {
    const source = node.childForFieldName('source');
    const moduleName = source ? tsStatic(source) : null;
    const provider = moduleName ? providerForModule(moduleName) : null;
    if (!provider) continue;
    ctx.importedProviders.add(provider);

    const clause = named(node).find((c) => c.type === 'import_clause');
    if (!clause) continue;
    for (const child of named(clause)) {
      if (child.type === 'identifier') {
        // default import: `import OpenAI from 'openai'` — the default export is the client class.
        ctx.ctorAliases.set(child.text, provider);
      } else if (child.type === 'namespace_import') {
        const alias = named(child).find((c) => c.type === 'identifier');
        if (alias) ctx.moduleAliases.set(alias.text, provider);
      } else if (child.type === 'named_imports') {
        for (const spec of named(child)) {
          if (spec.type !== 'import_specifier') continue;
          const orig = spec.childForFieldName('name')?.text;
          const alias = spec.childForFieldName('alias')?.text ?? orig;
          if (orig && alias && ctorSet(provider).has(orig)) ctx.ctorAliases.set(alias, provider);
        }
      }
    }
  }
}

/** Register LangChain chat-model constructors imported from @langchain/* packages. */
function collectLcImports(tree: Tree, language: Language, ctx: ModuleContext): void {
  for (const { node } of queries(language).imports.captures(tree.rootNode)) {
    const source = node.childForFieldName('source');
    const moduleName = source ? tsStatic(source) : null;
    if (!moduleName || !isLangChainModule(moduleName)) continue;
    const clause = named(node).find((c) => c.type === 'import_clause');
    const namedImports = clause && named(clause).find((c) => c.type === 'named_imports');
    if (!namedImports) continue;
    for (const spec of named(namedImports)) {
      if (spec.type !== 'import_specifier') continue;
      const orig = spec.childForFieldName('name')?.text;
      const alias = spec.childForFieldName('alias')?.text ?? orig;
      const p = orig ? langChainProvider(orig) : null;
      if (p && alias) {
        ctx.lcCtorAliases.set(alias, p);
        ctx.importedProviders.add(p);
      }
    }
  }
}

function providerOfNew(newNode: Node, ctx: ModuleContext): Provider | null {
  const ctor = newNode.childForFieldName('constructor');
  if (!ctor) return null;
  if (ctor.type === 'identifier') return ctx.ctorAliases.get(ctor.text) ?? null;
  if (ctor.type === 'member_expression') {
    const object = ctor.childForFieldName('object');
    const property = ctor.childForFieldName('property')?.text;
    if (object?.type === 'identifier' && property) {
      const p = ctx.moduleAliases.get(object.text);
      if (p && ctorSet(p).has(property)) return p;
    }
  }
  return null;
}

function collectDeclarators(tree: Tree, language: Language, ctx: ModuleContext): void {
  for (const { node } of queries(language).declarators.captures(tree.rootNode)) {
    const name = node.childForFieldName('name');
    const value = node.childForFieldName('value');
    if (!name || !value) continue;

    // CommonJS require: `const X = require('pkg')` / `const { Ctor } = require('pkg')`
    const pkg = isRequireCall(value);
    if (pkg) {
      const provider = providerForModule(pkg);
      if (provider) {
        ctx.importedProviders.add(provider);
        if (name.type === 'identifier') {
          ctx.ctorAliases.set(name.text, provider);
          ctx.moduleAliases.set(name.text, provider);
        } else if (name.type === 'object_pattern') {
          for (const el of named(name)) {
            if (el.type === 'shorthand_property_identifier_pattern' && ctorSet(provider).has(el.text)) {
              ctx.ctorAliases.set(el.text, provider);
            }
          }
        }
      } else if (isLangChainModule(pkg) && name.type === 'object_pattern') {
        // const { ChatOpenAI } = require('@langchain/openai')
        for (const el of named(name)) {
          if (el.type !== 'shorthand_property_identifier_pattern') continue;
          const p = langChainProvider(el.text);
          if (p) {
            ctx.lcCtorAliases.set(el.text, p);
            ctx.importedProviders.add(p);
          }
        }
      }
      continue;
    }

    // Client construction: `const client = new OpenAI()`
    if (value.type === 'new_expression' && name.type === 'identifier') {
      const provider = providerOfNew(value, ctx);
      if (provider) ctx.clientVars.set(name.text, provider);
    }
  }
}

/** Model from a `new ChatOpenAI({ model / modelName: "..." })` object argument. */
function lcCtorModel(newNode: Node): string | null {
  const args = newNode.childForFieldName('arguments');
  const obj = args && named(args).find((c) => c.type === 'object');
  if (!obj) return null;
  const value = objectPairValue(obj, 'model') ?? objectPairValue(obj, 'modelName');
  return value ? tsStatic(value) : null;
}

function collectLcBindings(tree: Tree, language: Language, ctx: ModuleContext): void {
  const rows = queries(language)
    .declarators.captures(tree.rootNode)
    .map(({ node }) => ({ name: node.childForFieldName('name'), value: node.childForFieldName('value') }));

  // Pass 1: `const llm = new ChatOpenAI({ model })`.
  for (const { name, value } of rows) {
    if (name?.type !== 'identifier' || value?.type !== 'new_expression') continue;
    const ctor = value.childForFieldName('constructor');
    const provider = ctor?.type === 'identifier' ? ctx.lcCtorAliases.get(ctor.text) : undefined;
    if (provider) ctx.modelVars.set(name.text, { provider, model: lcCtorModel(value) });
  }

  // Pass 2: `const chain = prompt.pipe(model)` — propagate the model binding.
  for (const { name, value } of rows) {
    if (name?.type !== 'identifier' || value?.type !== 'call_expression') continue;
    const fn = value.childForFieldName('function');
    if (fn?.type !== 'member_expression' || fn.childForFieldName('property')?.text !== 'pipe') continue;
    const args = value.childForFieldName('arguments');
    for (const a of args ? named(args) : []) {
      const bound = a.type === 'identifier' ? ctx.modelVars.get(a.text) : undefined;
      if (bound) ctx.modelVars.set(name.text, bound);
    }
  }
}

export function buildTsModuleContext(tree: Tree, language: Language): ModuleContext {
  const ctx = emptyModuleContext();
  collectImports(tree, language, ctx);
  collectLcImports(tree, language, ctx);
  collectDeclarators(tree, language, ctx);
  collectLcBindings(tree, language, ctx);
  return ctx;
}

// ---- symbol table (single-assignment const/let/var) ------------------------

export function buildTsSymbolTable(tree: Tree, language: Language): SymbolTable {
  const singles = new Map<string, Node>();
  const ambiguous = new Set<string>();
  const demote = (n: string) => {
    ambiguous.add(n);
    singles.delete(n);
  };

  for (const { node } of queries(language).declarators.captures(tree.rootNode)) {
    const name = node.childForFieldName('name');
    const value = node.childForFieldName('value');
    if (name?.type !== 'identifier' || !value) continue;
    if (ambiguous.has(name.text)) continue;
    if (singles.has(name.text)) demote(name.text);
    else singles.set(name.text, value);
  }
  // Any reassignment means the name is not a stable constant.
  for (const { node } of queries(language).reassigns.captures(tree.rootNode)) {
    if (node.type === 'identifier') demote(node.text);
  }
  return { singles, ambiguous };
}

// ---- value resolution ------------------------------------------------------

interface ResolveContext {
  symbols: SymbolTable;
  sourceDir: string;
}

const MAX_DEPTH = 16;
const LABEL_MAX = 48;

function label(node: Node): string {
  const t = node.text.replace(/\s+/g, ' ').trim();
  return t.length > LABEL_MAX ? t.slice(0, LABEL_MAX - 1) + '…' : t;
}

function resolved(text: string, source: ResolutionSource): ResolvedValue {
  return { status: 'resolved', text, segments: [{ kind: 'static', text }], source };
}
function unresolved(labelText: string, reason: string, source: ResolutionSource): ResolvedValue {
  return { status: 'unresolved', text: '', segments: [{ kind: 'dynamic', text: labelText }], source, reason };
}

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
  if (node.type === 'string') {
    return resolved(tsStatic(node) ?? '', 'literal');
  }
  // template_string
  const segments: PromptSegment[] = [];
  let dynamic = false;
  for (const child of named(node)) {
    if (child.type === 'string_fragment' || child.type === 'escape_sequence') {
      segments.push({ kind: 'static', text: child.text });
    } else if (child.type === 'template_substitution') {
      dynamic = true;
      const inner = named(child)[0];
      segments.push({ kind: 'dynamic', text: inner ? inner.text : child.text });
    }
  }
  const text = segments.filter((s) => s.kind === 'static').map((s) => s.text).join('');
  return dynamic
    ? { status: 'partial', text, segments, source: 'fstring', reason: 'contains runtime interpolation' }
    : { status: 'resolved', text, segments, source: 'literal' };
}

function fileLoadPath(callNode: Node): string | null {
  const fn = callNode.childForFieldName('function');
  if (!fn) return null;
  const method = fn.type === 'identifier' ? fn.text : fn.type === 'member_expression' ? fn.childForFieldName('property')?.text : null;
  if (method !== 'readFileSync') return null;
  const args = callNode.childForFieldName('arguments');
  const first = args ? named(args)[0] : null;
  return first ? tsStatic(first) : null;
}

function resolveExpr(node: Node, ctx: ResolveContext, visited = new Set<string>(), depth = 0): ResolvedValue {
  if (depth > MAX_DEPTH) return unresolved(label(node), 'resolution depth exceeded', 'unknown');
  switch (node.type) {
    case 'string':
    case 'template_string':
      return resolveStringNode(node);
    case 'binary_expression': {
      const op = node.childForFieldName('operator')?.text;
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (op !== '+' || !left || !right) return unresolved(label(node), `unsupported operator '${op ?? '?'}'`, 'concat');
      return combine([resolveExpr(left, ctx, visited, depth + 1), resolveExpr(right, ctx, visited, depth + 1)], 'concat');
    }
    case 'parenthesized_expression': {
      const inner = named(node)[0];
      return inner ? resolveExpr(inner, ctx, visited, depth + 1) : unresolved('()', 'empty expression', 'unknown');
    }
    case 'identifier': {
      const name = node.text;
      if (visited.has(name)) return unresolved(name, `circular reference to '${name}'`, 'const');
      if (ctx.symbols.ambiguous.has(name)) return unresolved(name, `'${name}' is reassigned — not a stable constant`, 'const');
      const rhs = ctx.symbols.singles.get(name);
      if (!rhs) return unresolved(name, `'${name}' not statically resolvable (parameter, import, or runtime value)`, 'const');
      return resolveExpr(rhs, ctx, new Set(visited).add(name), depth + 1);
    }
    case 'call_expression': {
      const p = fileLoadPath(node);
      if (p !== null) {
        const result = readPromptFile(p, ctx.sourceDir);
        return result.ok ? resolved(result.text ?? '', 'file') : unresolved(p, result.reason ?? 'file read failed', 'file');
      }
      return unresolved(label(node), 'value from function call', 'unknown');
    }
    default:
      return unresolved(label(node), `unsupported expression (${node.type})`, 'unknown');
  }
}

// ---- prompt extraction -----------------------------------------------------

function objectPairValue(obj: Node, key: string): Node | null {
  for (const pair of named(obj)) {
    if (pair.type !== 'pair') continue;
    if (keyName(pair.childForFieldName('key')) === key) return pair.childForFieldName('value');
  }
  return null;
}

/** Follow an identifier to an array literal if it resolves to one; else the node if it is an array. */
function asArrayLiteral(node: Node, ctx: ResolveContext, visited = new Set<string>()): Node | null {
  if (node.type === 'array') return node;
  if (node.type === 'identifier' && !visited.has(node.text)) {
    const rhs = ctx.symbols.singles.get(node.text);
    if (rhs) return asArrayLiteral(rhs, ctx, new Set(visited).add(node.text));
  }
  return null;
}

function resolveContent(node: Node, ctx: ResolveContext): ResolvedValue {
  if (node.type === 'array') {
    const blocks: ResolvedValue[] = [];
    for (const el of named(node)) {
      if (el.type === 'object') {
        const textVal = objectPairValue(el, 'text');
        blocks.push(textVal ? resolveExpr(textVal, ctx) : unresolved(label(el), 'content block without a text field', 'unknown'));
      } else {
        blocks.push(unresolved(label(el), 'non-object content block', 'unknown'));
      }
    }
    if (blocks.length === 0) return unresolved('[]', 'empty content list', 'unknown');
    return combine(blocks, 'concat');
  }
  return resolveExpr(node, ctx);
}

function resolveMessagesArg(node: Node, ctx: ResolveContext, origin: PromptOrigin): PromptPart[] {
  const list = asArrayLiteral(node, ctx);
  if (!list) {
    return [{ role: null, origin, value: unresolved(label(node), 'messages is not a static array', 'unknown') }];
  }
  const parts: PromptPart[] = [];
  for (const el of named(list)) {
    if (el.type !== 'object') {
      parts.push({ role: null, origin, value: unresolved(label(el), 'message is not a literal object', 'unknown') });
      continue;
    }
    const roleNode = objectPairValue(el, 'role');
    const role = roleNode ? tsStatic(roleNode) : null;
    const contentNode = objectPairValue(el, 'content');
    const value = contentNode ? resolveContent(contentNode, ctx) : unresolved(label(el), 'message has no content field', 'unknown');
    parts.push({ role, origin, value });
  }
  return parts;
}

function scalarPart(node: Node, ctx: ResolveContext, origin: PromptOrigin, role: string | null): PromptPart {
  return { role, origin, value: resolveContent(node, ctx) };
}

function aggregate(parts: PromptPart[]): ResolvedPrompt {
  if (parts.length === 0) return { status: 'unresolved', parts, reason: 'no prompt argument found' };
  const statuses = parts.map((p) => p.value.status);
  if (statuses.every((s) => s === 'resolved')) return { status: 'resolved', parts };
  const firstReason = parts.find((p) => p.value.status !== 'resolved')?.value.reason;
  if (statuses.every((s) => s === 'unresolved')) return { status: 'unresolved', parts, reason: firstReason };
  return { status: 'partial', parts, reason: firstReason };
}

function resolvePrompt(callNode: Node, argStyle: ArgStyle, ctx: ResolveContext): ResolvedPrompt {
  const parts: PromptPart[] = [];
  if (argStyle === 'chat') {
    const messages = keywordArgValue(callNode, 'messages');
    if (messages) parts.push(...resolveMessagesArg(messages, ctx, 'messages'));
  } else if (argStyle === 'messages') {
    const system = keywordArgValue(callNode, 'system');
    if (system) parts.push(scalarPart(system, ctx, 'system', 'system'));
    const messages = keywordArgValue(callNode, 'messages');
    if (messages) parts.push(...resolveMessagesArg(messages, ctx, 'messages'));
  } else if (argStyle === 'responses') {
    const instructions = keywordArgValue(callNode, 'instructions');
    if (instructions) parts.push(scalarPart(instructions, ctx, 'instructions', 'system'));
    const input = keywordArgValue(callNode, 'input');
    if (input) {
      const list = asArrayLiteral(input, ctx);
      if (list) parts.push(...resolveMessagesArg(input, ctx, 'input'));
      else parts.push(scalarPart(input, ctx, 'input', null));
    }
  } else if (argStyle === 'langchain') {
    parts.push(...resolveLangChainInput(callNode, ctx));
  }
  return aggregate(parts);
}

/** Content of a LangChain message element: `new HumanMessage("..")` / `["system", ".."]`. */
function resolveLangChainElement(el: Node, ctx: ResolveContext): PromptPart {
  if (el.type === 'new_expression') {
    const ctor = el.childForFieldName('constructor');
    const role = ctor?.type === 'identifier' ? messageRole(ctor.text) : null;
    const args = el.childForFieldName('arguments');
    const first = args ? named(args)[0] : null;
    const content = first?.type === 'object' ? objectPairValue(first, 'content') : first;
    return { role, origin: 'input', value: content ? resolveExpr(content, ctx) : unresolved(label(el), 'message without content', 'unknown') };
  }
  if (el.type === 'array') {
    const items = named(el);
    const role = items[0] ? tsStatic(items[0]) : null;
    return { role, origin: 'input', value: items[1] ? resolveExpr(items[1], ctx) : unresolved(label(el), 'empty message tuple', 'unknown') };
  }
  return { role: null, origin: 'input', value: unresolved(label(el), 'unsupported message element', 'unknown') };
}

/** Resolve the first argument of a LangChain `.invoke(...)`. */
function resolveLangChainInput(callNode: Node, ctx: ResolveContext): PromptPart[] {
  const args = callNode.childForFieldName('arguments');
  const arg = args ? named(args)[0] : null;
  if (!arg) return [{ role: null, origin: 'input', value: unresolved('', 'no prompt argument', 'unknown') }];

  const list = asArrayLiteral(arg, ctx);
  if (list) {
    const els = named(list);
    return els.length > 0
      ? els.map((el) => resolveLangChainElement(el, ctx))
      : [{ role: null, origin: 'input', value: unresolved('[]', 'empty message list', 'unknown') }];
  }
  if (arg.type === 'string' || arg.type === 'template_string' || arg.type === 'identifier') {
    return [{ role: null, origin: 'input', value: resolveExpr(arg, ctx) }];
  }
  return [{ role: null, origin: 'input', value: unresolved(label(arg), 'LangChain input (prompt may be defined in a template)', 'unknown') }];
}

// ---- detection -------------------------------------------------------------

function extractModel(callNode: Node): { model: string | null; hint: string | null } {
  const value = keywordArgValue(callNode, 'model');
  if (!value) return { model: null, hint: null };
  const literal = tsStatic(value);
  if (literal !== null) return { model: literal, hint: null };
  return { model: null, hint: value.text };
}

/** Detect OpenAI/Anthropic call sites in a parsed TS/JS module and resolve each prompt. */
export function detectTsCallSites(tree: Tree, language: Language, relPath: string, absPath: string): CallSite[] {
  const ctx = buildTsModuleContext(tree, language);
  const symbols = buildTsSymbolTable(tree, language);
  const resolveCtx: ResolveContext = { symbols, sourceDir: path.dirname(absPath) };

  const sites: CallSite[] = [];
  for (const match of queries(language).calls.matches(tree.rootNode)) {
    const fn = match.captures.find((c) => c.name === 'fn')?.node;
    const node = match.captures.find((c) => c.name === 'call')?.node;
    if (!fn || !node) continue;

    const receiver = baseIdentifier(fn);
    const direct = classify(fn.text, receiver, ctx);
    const lc = direct ? null : classifyLangChain(fn.text, receiver, ctx);
    if (!direct && !lc) continue;

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
      model = lc!.model;
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
  return sites;
}
