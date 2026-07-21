import { countTokens } from '../tokens/tokenizer.js';
import { normalizeText, wordSet } from './text.js';
import type {
  BloatReport,
  BoilerplateBlock,
  CallSite,
  FewShotPrompt,
  OversizedPrompt,
  SiteRef,
} from '../report/types.js';

export interface BloatOptions {
  /** A resolved prompt at or above this many tokens is "oversized". Default 2000. */
  largeTokens?: number;
  /** A prompt with at least this many message parts is "few-shot". Default 6. */
  manyMessages?: number;
  /** A block repeated across at least this many call sites is boilerplate. Default 3. */
  boilerplateMinSites?: number;
  /** Minimum distinct words for a block to count as boilerplate. Default 8. */
  boilerplateMinWords?: number;
}

/**
 * Context-bloat heuristics (all labeled as such). Three lenses:
 *  - oversized: one prompt above a token threshold
 *  - few-shot: a prompt with many message parts (example pile-up)
 *  - boilerplate: a prompt *block* repeated verbatim across call sites — the
 *    part-level analogue of duplicate detection (a shared system prompt across
 *    prompts whose user turns differ), a caching/extraction candidate.
 * Only resolved/partial prompts are considered.
 */
export function analyzeBloat(callSites: CallSite[], opts: BloatOptions = {}): BloatReport {
  const largeTokens = opts.largeTokens ?? 2000;
  const manyMessages = opts.manyMessages ?? 6;
  const minSites = opts.boilerplateMinSites ?? 3;
  const minWords = opts.boilerplateMinWords ?? 8;

  const oversized: OversizedPrompt[] = [];
  const fewShot: FewShotPrompt[] = [];
  const blocks = new Map<string, Map<string, SiteRef>>();

  for (const site of callSites) {
    if (site.prompt.status === 'unresolved') continue;

    if (site.tokens.inputTokens >= largeTokens) {
      oversized.push({ file: site.file, line: site.line, tokens: site.tokens.inputTokens });
    }
    if (site.prompt.parts.length >= manyMessages) {
      fewShot.push({
        file: site.file,
        line: site.line,
        messageCount: site.prompt.parts.length,
        tokens: site.tokens.inputTokens,
      });
    }

    // Group each substantial prompt block by its normalized text, counting a
    // call site at most once per distinct block.
    const seen = new Set<string>();
    for (const part of site.prompt.parts) {
      const norm = normalizeText(part.value.text);
      if (!norm || wordSet(norm).size < minWords || seen.has(norm)) continue;
      seen.add(norm);
      let sites = blocks.get(norm);
      if (!sites) {
        sites = new Map();
        blocks.set(norm, sites);
      }
      sites.set(`${site.file}:${site.line}`, { file: site.file, line: site.line });
    }
  }

  oversized.sort((a, b) => b.tokens - a.tokens);
  fewShot.sort((a, b) => b.tokens - a.tokens);

  const boilerplate: BoilerplateBlock[] = [];
  for (const [text, sites] of blocks) {
    if (sites.size < minSites) continue;
    boilerplate.push({ text, tokens: countTokens(text, 'o200k_base'), sites: [...sites.values()] });
  }
  // Rank by total repeated tokens (block size × extra copies).
  boilerplate.sort((a, b) => b.tokens * (b.sites.length - 1) - a.tokens * (a.sites.length - 1));

  return {
    oversized,
    fewShot,
    boilerplate,
    thresholds: { largeTokens, manyMessages, boilerplateMinSites: minSites },
  };
}
