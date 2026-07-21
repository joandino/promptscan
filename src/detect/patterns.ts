import type { ModuleContext, Provider } from './providers.js';
import type { Confidence, MatchBasis } from '../report/types.js';

/**
 * Argument shape of an LLM call, shared across a method family so that
 * create/parse/stream variants all resolve identically, and across languages.
 */
export type ArgStyle = 'chat' | 'messages' | 'responses';

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
 * Method-chain suffixes we treat as LLM calls — identical for Python and
 * TS/JS since member access uses `.` in both. create/parse/stream take the same
 * prompt arguments. Long chat.completions chains are self-identifying; the short
 * responses and messages chains are gated (see classify) because e.g.
 * `client.messages.create` / `.stream` is also Twilio's SMS API.
 */
export const METHOD_PATTERNS: MethodPattern[] = [
  { suffix: '.chat.completions.create', provider: 'openai', method: 'chat.completions.create', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.chat.completions.parse', provider: 'openai', method: 'chat.completions.parse', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.chat.completions.stream', provider: 'openai', method: 'chat.completions.stream', argStyle: 'chat', selfIdentifying: true },
  { suffix: '.responses.create', provider: 'openai', method: 'responses.create', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.responses.parse', provider: 'openai', method: 'responses.parse', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.responses.stream', provider: 'openai', method: 'responses.stream', argStyle: 'responses', selfIdentifying: false },
  { suffix: '.messages.create', provider: 'anthropic', method: 'messages.create', argStyle: 'messages', selfIdentifying: false },
  { suffix: '.messages.stream', provider: 'anthropic', method: 'messages.stream', argStyle: 'messages', selfIdentifying: false },
];

export interface Classification {
  provider: Provider;
  method: string;
  argStyle: ArgStyle;
  confidence: Confidence;
  basis: MatchBasis;
}

/**
 * Decide whether a method-call chain is an LLM call site and at what confidence.
 * Language-agnostic: takes the chain text, the receiver variable name (or null),
 * and the module's import/binding context.
 */
export function classify(chain: string, receiver: string | null, ctx: ModuleContext): Classification | null {
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
