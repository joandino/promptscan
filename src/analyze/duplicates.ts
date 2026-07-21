import type {
  CallSite,
  DuplicateGroup,
  DuplicateReport,
  NearDuplicatePair,
  SiteRef,
} from '../report/types.js';

/** Prompts with fewer distinct words than this are ignored (too trivial to matter). */
const DEFAULT_MIN_WORDS = 5;
/** Above this many distinct prompts, skip the O(n²) near-duplicate pass. */
const NEAR_PAIR_CAP = 2000;

export interface DuplicateOptions {
  /** Near-duplicate similarity threshold, 0..1. Default 0.85. */
  threshold?: number;
  minWords?: number;
}

/** Collapse whitespace and trim, so trivially-different spacing still matches. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** The full prompt text of a call site: all parts joined. */
function canonicalText(site: CallSite): string {
  return site.prompt.parts.map((p) => p.value.text).join('\n');
}

/** Lowercased distinct-word set for token-set Jaccard. */
function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function ref(site: CallSite): SiteRef {
  return { file: site.file, line: site.line };
}

interface Candidate {
  site: CallSite;
  norm: string;
  words: Set<string>;
}

/**
 * Find exact and near-duplicate prompts across call sites. Only fully-resolved
 * prompts are considered — partial/unresolved content would produce misleading
 * matches. Trivially short prompts are excluded (see minWords).
 */
export function findDuplicates(callSites: CallSite[], opts: DuplicateOptions = {}): DuplicateReport {
  const threshold = opts.threshold ?? 0.85;
  const minWords = opts.minWords ?? DEFAULT_MIN_WORDS;

  const candidates: Candidate[] = [];
  for (const site of callSites) {
    if (site.prompt.status !== 'resolved') continue;
    const norm = normalize(canonicalText(site));
    if (!norm) continue;
    const words = wordSet(norm);
    if (words.size < minWords) continue;
    candidates.push({ site, norm, words });
  }

  // --- Exact duplicates: group by normalized text ---
  const byText = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const bucket = byText.get(c.norm);
    if (bucket) bucket.push(c);
    else byText.set(c.norm, [c]);
  }

  const exact: DuplicateGroup[] = [];
  const uniques: Candidate[] = [];
  for (const bucket of byText.values()) {
    uniques.push(bucket[0]);
    if (bucket.length >= 2) {
      exact.push({
        text: bucket[0].norm,
        tokens: bucket[0].site.tokens.inputTokens,
        sites: bucket.map((c) => ref(c.site)),
      });
    }
  }
  exact.sort((a, b) => b.sites.length - a.sites.length || b.tokens - a.tokens);

  // --- Near duplicates: pairwise over distinct prompts ---
  const near: NearDuplicatePair[] = [];
  let nearNote: string | undefined;
  if (uniques.length > NEAR_PAIR_CAP) {
    nearNote = `near-duplicate analysis skipped: ${uniques.length} distinct prompts exceeds cap of ${NEAR_PAIR_CAP}`;
  } else {
    for (let i = 0; i < uniques.length; i++) {
      for (let j = i + 1; j < uniques.length; j++) {
        const sim = jaccard(uniques[i].words, uniques[j].words);
        if (sim >= threshold && sim < 1) {
          near.push({ similarity: sim, a: ref(uniques[i].site), b: ref(uniques[j].site) });
        }
      }
    }
    near.sort((a, b) => b.similarity - a.similarity);
  }

  return { exact, near, threshold, minWords, comparedPrompts: uniques.length, nearNote };
}
