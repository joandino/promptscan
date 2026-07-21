import type { Node, Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';

export type Provider = 'openai' | 'anthropic';

/** Client constructor names, per provider, used to bind variables to providers. */
const OPENAI_CTORS = new Set(['OpenAI', 'AsyncOpenAI', 'AzureOpenAI', 'AsyncAzureOpenAI']);
const ANTHROPIC_CTORS = new Set([
  'Anthropic',
  'AsyncAnthropic',
  'AnthropicBedrock',
  'AsyncAnthropicBedrock',
  'AnthropicVertex',
  'AsyncAnthropicVertex',
]);

function ctorSet(provider: Provider): Set<string> {
  return provider === 'openai' ? OPENAI_CTORS : ANTHROPIC_CTORS;
}

function providerForModule(moduleName: string): Provider | null {
  const head = moduleName.split('.')[0];
  if (head === 'openai') return 'openai';
  if (head === 'anthropic') return 'anthropic';
  return null;
}

/**
 * Per-module facts gathered from imports and assignments, used to raise or
 * gate confidence in call-site detection.
 */
export interface ModuleContext {
  /** Providers whose SDK is imported anywhere in the file. */
  importedProviders: Set<Provider>;
  /** Local module name (possibly aliased) → provider, e.g. 'openai'→openai. */
  moduleAliases: Map<string, Provider>;
  /** Local constructor name (possibly aliased) → provider, e.g. 'OpenAI'→openai. */
  ctorAliases: Map<string, Provider>;
  /** Variable name → provider it was constructed from, e.g. 'client'→anthropic. */
  clientVars: Map<string, Provider>;
}

function collectImports(tree: Tree, language: Language, ctx: ModuleContext): void {
  const { imports } = getDetectionQueries(language);
  for (const { node } of imports.captures(tree.rootNode)) {
    if (node.type === 'import_statement') {
      // import a, b as c
      for (const child of node.namedChildren) {
        if (!child) continue;
        if (child.type === 'dotted_name') {
          registerModuleImport(child.text, child.text, ctx);
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name')?.text;
          const alias = child.childForFieldName('alias')?.text;
          if (name && alias) registerModuleImport(name, alias, ctx);
        }
      }
    } else if (node.type === 'import_from_statement') {
      // from mod import a, b as c
      const moduleNode = node.childForFieldName('module_name');
      const moduleName = moduleNode?.text;
      const provider = moduleName ? providerForModule(moduleName) : null;
      if (!provider) continue;
      ctx.importedProviders.add(provider);
      for (const child of node.namedChildren) {
        if (!child || child === moduleNode) continue;
        if (child.type === 'dotted_name') {
          registerSymbolImport(child.text, child.text, provider, ctx);
        } else if (child.type === 'aliased_import') {
          const orig = child.childForFieldName('name')?.text;
          const alias = child.childForFieldName('alias')?.text;
          if (orig && alias) registerSymbolImport(orig, alias, provider, ctx);
        }
      }
    }
  }
}

function registerModuleImport(moduleName: string, localName: string, ctx: ModuleContext): void {
  const provider = providerForModule(moduleName);
  if (!provider) return;
  ctx.importedProviders.add(provider);
  ctx.moduleAliases.set(localName.split('.')[0], provider);
}

function registerSymbolImport(
  origName: string,
  localName: string,
  provider: Provider,
  ctx: ModuleContext,
): void {
  // Only treat known client constructors as ctor aliases — avoids mis-binding
  // on unrelated names imported from the same package (e.g. error classes).
  if (ctorSet(provider).has(origName)) {
    ctx.ctorAliases.set(localName, provider);
  }
}

/** Resolve `x = <ctor>(...)` to the provider it constructs, if any. */
function providerOfConstruction(callNode: Node, ctx: ModuleContext): Provider | null {
  const fn = callNode.childForFieldName('function');
  if (!fn) return null;

  if (fn.type === 'identifier') {
    // OpenAI(...) / AsyncAnthropic(...) via a from-import.
    return ctx.ctorAliases.get(fn.text) ?? null;
  }

  if (fn.type === 'attribute') {
    // openai.OpenAI(...) / anthropic.Anthropic(...)
    const objectNode = fn.childForFieldName('object');
    const property = fn.childForFieldName('attribute')?.text;
    if (objectNode?.type === 'identifier' && property) {
      const provider = ctx.moduleAliases.get(objectNode.text);
      if (provider && ctorSet(provider).has(property)) return provider;
    }
  }

  return null;
}

function collectClientVars(tree: Tree, language: Language, ctx: ModuleContext): void {
  const { assignments } = getDetectionQueries(language);
  for (const match of assignments.matches(tree.rootNode)) {
    const nameNode = match.captures.find((c) => c.name === 'name')?.node;
    const rhsNode = match.captures.find((c) => c.name === 'rhs')?.node;
    if (!nameNode || !rhsNode) continue;
    const provider = providerOfConstruction(rhsNode, ctx);
    if (provider) ctx.clientVars.set(nameNode.text, provider);
  }
}

/** Build the import/binding context for a single parsed module. */
export function buildModuleContext(tree: Tree, language: Language): ModuleContext {
  const ctx: ModuleContext = {
    importedProviders: new Set(),
    moduleAliases: new Map(),
    ctorAliases: new Map(),
    clientVars: new Map(),
  };
  collectImports(tree, language, ctx);
  collectClientVars(tree, language, ctx);
  return ctx;
}
