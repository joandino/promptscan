/**
 * 'other' is a detected LLM call whose backend PromptScan does not natively
 * tokenize or price — a litellm call routed to a non-OpenAI/Anthropic provider
 * (Gemini, Cohere, …) or one whose model couldn't be statically determined.
 * Such calls are still reported, with a rough proxy token count and no price.
 */
export type Provider = 'openai' | 'anthropic' | 'other';

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
  if (provider === 'openai') return OPENAI_CTORS;
  if (provider === 'anthropic') return ANTHROPIC_CTORS;
  return new Set();
}

/** litellm entrypoints that take `model=` + `messages=` (the OpenAI chat shape). */
export const LITELLM_METHODS = new Set(['completion', 'acompletion']);

/** True if an import target is the litellm package (`litellm`, `litellm.*`). */
export function isLiteLLMModule(name: string): boolean {
  const n = name.toLowerCase();
  return n === 'litellm' || n.startsWith('litellm.');
}

/** litellm `model=` prefixes that route to an OpenAI-tokenizable backend. */
const LITELLM_OPENAI_PREFIXES = new Set([
  'openai',
  'azure',
  'azure_ai',
  'azure_text',
  'text-completion-openai',
]);

/**
 * Map a litellm `model=` string to the provider PromptScan tokenizes/prices and
 * a canonical model id. litellm routes many providers through one call, encoding
 * the target in the model string (`anthropic/…`, `gemini/…`, or a bare name).
 * Claude hosted behind bedrock/vertex is detected by name. Anything we can't
 * natively tokenize/price maps to 'other' — still reported, honestly labeled.
 */
export function providerForLiteLLMModel(raw: string): { provider: Provider; model: string } {
  const t = raw.trim();
  const lower = t.toLowerCase();
  const slash = t.indexOf('/');
  const prefix = slash >= 0 ? lower.slice(0, slash) : '';
  const core = slash >= 0 ? t.slice(slash + 1) : t;

  if (lower.includes('claude') || prefix === 'anthropic') {
    // Strip a `bedrock/anthropic.claude-…` style vendor segment for pricing.
    const model = core.toLowerCase().startsWith('anthropic.')
      ? core.slice('anthropic.'.length)
      : core;
    return { provider: 'anthropic', model };
  }
  if (LITELLM_OPENAI_PREFIXES.has(prefix)) {
    return { provider: 'openai', model: core };
  }
  if (prefix === '' && /^(gpt-|o1|o3|o4|chatgpt-)/.test(lower)) {
    return { provider: 'openai', model: t };
  }
  return { provider: 'other', model: t };
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

/** Vercel AI SDK entrypoints that take a `{ model, system, prompt, messages }` object. */
export const VERCEL_AI_FUNCTIONS = new Set([
  'generateText',
  'streamText',
  'generateObject',
  'streamObject',
]);

/** True if a package is the Vercel AI SDK core (`ai`). */
export function isVercelAiModule(name: string): boolean {
  return name === 'ai';
}

/** Provider for an `@ai-sdk/*` model-factory package, or null if it isn't one. */
export function aiSdkProvider(pkg: string): Provider | null {
  if (!pkg.startsWith('@ai-sdk/')) return null;
  const sub = pkg.slice('@ai-sdk/'.length);
  if (sub === 'openai' || sub === 'azure' || sub === 'openai-compatible') return 'openai';
  if (sub === 'anthropic') return 'anthropic';
  // Any other provider (google, mistral, cohere, …) we can't natively tokenize/price.
  return 'other';
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
  /** Local alias of the imported litellm module (`import litellm as ll`), else null. */
  litellmModule: string | null;
  /** Local name → canonical litellm fn ('completion'|'acompletion') from a from-import. */
  litellmFns: Map<string, string>;
  /** Local names of Vercel AI SDK entrypoints imported from `ai` (generateText, …). */
  vercelFns: Set<string>;
  /** Local name → provider for an `@ai-sdk/*` model factory (`openai`, `anthropic`, …). */
  aiSdkFactories: Map<string, Provider>;
  /** Local name → provider for an `@ai-sdk/*` factory *creator* (`createOpenAI`, …). */
  aiSdkCreators: Map<string, Provider>;
}

export function emptyModuleContext(): ModuleContext {
  return {
    importedProviders: new Set(),
    moduleAliases: new Map(),
    ctorAliases: new Map(),
    clientVars: new Map(),
    lcCtorAliases: new Map(),
    modelVars: new Map(),
    litellmModule: null,
    litellmFns: new Map(),
    vercelFns: new Set(),
    aiSdkFactories: new Map(),
    aiSdkCreators: new Map(),
  };
}
