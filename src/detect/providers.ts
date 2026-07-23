import type { Node, Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';
import {
  ctorSet,
  providerForModule,
  emptyModuleContext,
  langChainProvider,
  isLangChainModule,
  isLiteLLMModule,
  LITELLM_METHODS,
  type ModuleContext,
  type Provider,
} from './context.js';
import { keywordArgValue, staticString } from '../resolve/nodes.js';

export type { Provider, ModuleContext } from './context.js';

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
      const langchain = moduleName ? isLangChainModule(moduleName) : false;
      const litellm = moduleName ? isLiteLLMModule(moduleName) : false;
      // Re-exported litellm proxy: `from aider.llm import litellm` (a common
      // lazy-import pattern). The symbol name 'litellm' is unambiguous.
      const reexportsLitellm = node.namedChildren.some((c) => {
        if (!c || c === moduleNode) return false;
        if (c.type === 'dotted_name') return c.text === 'litellm';
        if (c.type === 'aliased_import') return c.childForFieldName('name')?.text === 'litellm';
        return false;
      });
      if (!provider && !langchain && !litellm && !reexportsLitellm) continue;
      if (provider) ctx.importedProviders.add(provider);
      for (const child of node.namedChildren) {
        if (!child || child === moduleNode) continue;
        let orig: string | undefined;
        let alias: string | undefined;
        if (child.type === 'dotted_name') {
          orig = child.text;
          alias = child.text;
        } else if (child.type === 'aliased_import') {
          orig = child.childForFieldName('name')?.text;
          alias = child.childForFieldName('alias')?.text;
        }
        if (!orig || !alias) continue;
        if (provider) registerSymbolImport(orig, alias, provider, ctx);
        if (langchain) registerLangChainImport(orig, alias, ctx);
        // `from litellm import completion, acompletion as x` → bind the local name.
        if (litellm && LITELLM_METHODS.has(orig)) ctx.litellmFns.set(alias, orig);
        // `from <anywhere> import litellm [as x]` → bind the module alias.
        if (orig === 'litellm') ctx.litellmModule = alias;
      }
    }
  }
}

function registerModuleImport(moduleName: string, localName: string, ctx: ModuleContext): void {
  // `import litellm` / `import litellm as ll` — record the local module alias so
  // `litellm.completion(...)` calls can be attributed to litellm.
  if (isLiteLLMModule(moduleName)) ctx.litellmModule = localName.split('.')[0];
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

/** Register a LangChain chat-model constructor imported from a langchain package. */
function registerLangChainImport(origName: string, localName: string, ctx: ModuleContext): void {
  const provider = langChainProvider(origName);
  if (!provider) return;
  ctx.lcCtorAliases.set(localName, provider);
  ctx.importedProviders.add(provider);
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

/** Model from a LangChain constructor's `model=`/`model_name=` argument. */
function ctorModel(callNode: Node): string | null {
  const value = keywordArgValue(callNode, 'model') ?? keywordArgValue(callNode, 'model_name');
  return value ? staticString(value) : null;
}

/** Flatten a `a | b | c` pipe expression into its operands. */
function pipeOperands(node: Node): Node[] {
  if (node.type === 'binary_operator' && node.childForFieldName('operator')?.text === '|') {
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    return [...(left ? pipeOperands(left) : []), ...(right ? pipeOperands(right) : [])];
  }
  return [node];
}

function collectLangChain(tree: Tree, language: Language, ctx: ModuleContext): void {
  const { anyAssignments } = getDetectionQueries(language);
  const rows = anyAssignments.matches(tree.rootNode).map((m) => ({
    name: m.captures.find((c) => c.name === 'name')?.node,
    rhs: m.captures.find((c) => c.name === 'rhs')?.node,
  }));

  // Pass 1: `llm = ChatOpenAI(model=...)` — bind the variable to provider + model.
  for (const { name, rhs } of rows) {
    if (!name || rhs?.type !== 'call') continue;
    const fn = rhs.childForFieldName('function');
    const provider = fn?.type === 'identifier' ? ctx.lcCtorAliases.get(fn.text) : undefined;
    if (provider) ctx.modelVars.set(name.text, { provider, model: ctorModel(rhs) });
  }

  // Pass 2: `chain = prompt | llm` — propagate the model binding to the chain.
  for (const { name, rhs } of rows) {
    if (!name || rhs?.type !== 'binary_operator') continue;
    const bound = pipeOperands(rhs)
      .filter((n) => n.type === 'identifier')
      .map((n) => ctx.modelVars.get(n.text))
      .filter((b): b is NonNullable<typeof b> => !!b);
    if (bound.length > 0) ctx.modelVars.set(name.text, bound[bound.length - 1]);
  }
}

/** Build the import/binding context for a single parsed module. */
export function buildModuleContext(tree: Tree, language: Language): ModuleContext {
  const ctx = emptyModuleContext();
  collectImports(tree, language, ctx);
  collectClientVars(tree, language, ctx);
  collectLangChain(tree, language, ctx);
  return ctx;
}
