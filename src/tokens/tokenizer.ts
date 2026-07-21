import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { Provider, ResolvedPrompt, TokenEstimate } from '../report/types.js';
import { resolveEncoding, encodingLabel, type EncodingName } from './models.js';

/**
 * Documented OpenAI chat overhead: each message costs a few structural tokens,
 * and the reply is primed with a few more. We include this (and label it) so
 * counts track real request sizes rather than bare content. It is an
 * approximation for Anthropic and responses-style calls.
 */
const PER_MESSAGE_TOKENS = 3;
const PRIMING_TOKENS = 3;

const encoderCache = new Map<EncodingName, Tiktoken>();

function encoder(name: EncodingName): Tiktoken {
  let enc = encoderCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    encoderCache.set(name, enc);
  }
  return enc;
}

export function countTokens(text: string, name: EncodingName): number {
  if (!text) return 0;
  return encoder(name).encode(text).length;
}

/**
 * Estimate input tokens for a call site's resolved prompt. Counts static
 * content only; dynamic/unresolved portions are excluded and flagged. This is
 * always an estimate of INPUT tokens — output tokens aren't statically knowable.
 */
export function estimateTokens(
  provider: Provider,
  model: string | null,
  prompt: ResolvedPrompt,
): TokenEstimate {
  const { encoding, matched } = resolveEncoding(provider, model);

  let contentTokens = 0;
  let overheadTokens = 0;
  for (const part of prompt.parts) {
    contentTokens += countTokens(part.value.text, encoding);
    overheadTokens += PER_MESSAGE_TOKENS;
    if (part.role) overheadTokens += countTokens(part.role, encoding);
  }
  if (prompt.parts.length > 0) overheadTokens += PRIMING_TOKENS;

  const notes: string[] = [];
  if (provider === 'anthropic') {
    notes.push('anthropic: cl100k_base proxy tokenizer (no public tokenizer) — approximate');
  }
  if (prompt.status === 'partial') {
    notes.push('partial prompt: static content only — a floor, not the full size');
  } else if (prompt.status === 'unresolved') {
    notes.push('prompt unresolved: content not counted (overhead only)');
  }
  if (!matched && provider === 'openai') {
    notes.push(`unrecognized model${model ? ` '${model}'` : ''}: assumed o200k_base encoding`);
  }

  // "approximate" means the tokenizer itself is inexact (proxy or fallback
  // encoding). Partial-content undercount is conveyed separately (a floor).
  const approximate = provider === 'anthropic' || !matched;

  return {
    contentTokens,
    overheadTokens,
    inputTokens: contentTokens + overheadTokens,
    approximate,
    encoding: encodingLabel(provider, encoding),
    notes,
  };
}
