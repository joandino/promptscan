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

export function emptyModuleContext(): ModuleContext {
  return {
    importedProviders: new Set(),
    moduleAliases: new Map(),
    ctorAliases: new Map(),
    clientVars: new Map(),
  };
}
