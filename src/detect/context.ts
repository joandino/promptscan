export type Provider = 'openai' | 'anthropic';

/** Client constructor names, per provider, used to bind variables to providers. */
export const OPENAI_CTORS = new Set(['OpenAI', 'AsyncOpenAI', 'AzureOpenAI', 'AsyncAzureOpenAI']);
export const ANTHROPIC_CTORS = new Set([
  'Anthropic',
  'AsyncAnthropic',
  'AnthropicBedrock',
  'AsyncAnthropicBedrock',
  'AnthropicVertex',
  'AsyncAnthropicVertex',
]);

export function ctorSet(provider: Provider): Set<string> {
  return provider === 'openai' ? OPENAI_CTORS : ANTHROPIC_CTORS;
}

/** LangChain chat-model class names, per provider. */
const LC_OPENAI_CTORS = new Set(['ChatOpenAI', 'AzureChatOpenAI']);
const LC_ANTHROPIC_CTORS = new Set(['ChatAnthropic']);

/** Provider for a LangChain chat-model constructor name, or null. */
export function langChainProvider(ctorName: string): Provider | null {
  if (LC_OPENAI_CTORS.has(ctorName)) return 'openai';
  if (LC_ANTHROPIC_CTORS.has(ctorName)) return 'anthropic';
  return null;
}

/** True if an import target is a LangChain package (langchain*, @langchain/*). */
export function isLangChainModule(name: string): boolean {
  return name.toLowerCase().includes('langchain');
}

/** Message-class name → chat role, for resolving invoke([...]) message lists. */
export function messageRole(ctorName: string): string | null {
  if (ctorName.startsWith('System')) return 'system';
  if (ctorName.startsWith('Human')) return 'user';
  if (ctorName.startsWith('AI') || ctorName.startsWith('Assistant')) return 'assistant';
  return null;
}

/**
 * Map an import target to a provider. Handles both Python module names
 * (`openai`, `anthropic`, `openai.types`) and JS/TS package names
 * (`openai`, `@anthropic-ai/sdk`).
 */
export function providerForModule(name: string): Provider | null {
  const n = name.toLowerCase();
  if (n === 'openai' || n.startsWith('openai.') || n.startsWith('openai/')) return 'openai';
  if (
    n === 'anthropic' ||
    n.startsWith('anthropic.') ||
    n.startsWith('anthropic/') ||
    n.startsWith('@anthropic-ai/')
  ) {
    return 'anthropic';
  }
  return null;
}

/**
 * Per-module facts gathered from imports and constructions, used to raise or
 * gate confidence in call-site detection. Built per language, consumed by the
 * shared classifier.
 */
/** A LangChain-bound variable: its provider and (constructor-time) model. */
export interface LangChainBinding {
  provider: Provider;
  model: string | null;
}

export interface ModuleContext {
  /** Providers whose SDK is imported anywhere in the file. */
  importedProviders: Set<Provider>;
  /** Local module name (possibly aliased) → provider, e.g. 'openai'→openai. */
  moduleAliases: Map<string, Provider>;
  /** Local constructor name (possibly aliased) → provider, e.g. 'OpenAI'→openai. */
  ctorAliases: Map<string, Provider>;
  /** Variable name → provider it was constructed from, e.g. 'client'→anthropic. */
  clientVars: Map<string, Provider>;
  /** Local LangChain constructor name → provider, e.g. 'ChatOpenAI'→openai. */
  lcCtorAliases: Map<string, Provider>;
  /** Variable bound to a LangChain model (or a chain ending in one). */
  modelVars: Map<string, LangChainBinding>;
}

export function emptyModuleContext(): ModuleContext {
  return {
    importedProviders: new Set(),
    moduleAliases: new Map(),
    ctorAliases: new Map(),
    clientVars: new Map(),
    lcCtorAliases: new Map(),
    modelVars: new Map(),
  };
}
