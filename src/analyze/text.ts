import type { CallSite } from '../report/types.js';

/** Collapse whitespace and trim, so trivial spacing differences still match. */
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** The full prompt text of a call site: all parts joined. */
export function canonicalText(site: CallSite): string {
  return site.prompt.parts.map((p) => p.value.text).join('\n');
}

/** Normalized canonical prompt text for a call site. */
export function normalizedPrompt(site: CallSite): string {
  return normalizeText(canonicalText(site));
}

/** Lowercased distinct-word set for token-set Jaccard. */
export function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
