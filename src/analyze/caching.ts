import { normalizeText } from './text.js';
import { minCacheableTokens, CACHE_READ_MULTIPLIER } from '../pricing/caching.js';
import type {
  BelowMinimumSite,
  CacheOpportunity,
  CachingReport,
  CallSite,
  SiteRef,
} from '../report/types.js';

export interface CachingOptions {
  /**
   * Ignore sites whose cacheable prefix is under this many tokens even if the
   * model would allow caching. Purely a noise floor; the per-model API minimum
   * is always enforced on top of it. Default 0 (model minimum only).
   */
  minTokens?: number;
}

/**
 * Find call sites that should be using prompt caching but aren't.
 *
 * Scope is deliberately Anthropic-only. OpenAI caches automatically with no
 * marker and no code change, so there is no action to recommend and no opt-in to
 * detect — flagging those sites would be noise, and applying a speculative
 * discount would be guessing at a hit rate we can't observe statically.
 *
 * The per-model minimum is the load-bearing rule: a `cache_control` breakpoint
 * on a prefix below it is silently ignored by the API, so recommending one would
 * be wrong advice. Sites under the minimum are counted, never recommended.
 */
/**
 * Tokens in the stable, cacheable PREFIX of a prompt: the leading parts that are
 * fully resolved, stopping at the first one containing runtime content.
 *
 * Summing every static part would overstate this. A prompt shaped
 * `[dynamic user turn, static system text]` has a large static total but no
 * large stable prefix — caching it would save nothing, because the cache
 * breakpoint can only cover a contiguous prefix that is identical across calls.
 */
function cacheablePrefixTokens(site: CallSite): number {
  const parts = site.prompt.parts;
  let prefixChars = 0;
  let totalChars = 0;
  let stillPrefix = true;
  for (const part of parts) {
    const len = part.value.text.length;
    totalChars += len;
    if (stillPrefix && part.value.status === 'resolved') prefixChars += len;
    else stillPrefix = false;
  }
  if (totalChars === 0) return 0;
  // Scale the site's counted content tokens by the prefix's share of the text,
  // which keeps the provider's tokenizer/encoding choice intact.
  return Math.floor(site.tokens.contentTokens * (prefixChars / totalChars));
}

export function analyzeCaching(callSites: CallSite[], opts: CachingOptions = {}): CachingReport {
  const floor = opts.minTokens ?? 0;

  const opportunities: CacheOpportunity[] = [];
  const belowMinimum: BelowMinimumSite[] = [];
  let cachedSites = 0;
  let skippedUnknownModel = 0;

  // Group sites by prompt text so identical prompts can be reported as sharing
  // one cache entry — caching a block used at 5 sites is one edit, not five.
  const byText = new Map<string, SiteRef[]>();
  for (const site of callSites) {
    if (site.provider !== 'anthropic' || site.prompt.status === 'unresolved') continue;
    const norm = normalizeText(site.prompt.parts.map((p) => p.value.text).join('\n'));
    if (!norm) continue;
    const refs = byText.get(norm);
    if (refs) refs.push({ file: site.file, line: site.line });
    else byText.set(norm, [{ file: site.file, line: site.line }]);
  }

  for (const site of callSites) {
    if (site.provider !== 'anthropic') continue;
    if (site.prompt.status === 'unresolved') continue;

    if (site.tokens.cachedTokens > 0) {
      cachedSites++;
      continue;
    }

    // Without a resolved model we can't know the minimum — skip rather than
    // assume, and report the count so the gap is visible.
    if (!site.model) {
      if (cacheablePrefixTokens(site) >= Math.max(floor, 512)) skippedUnknownModel++;
      continue;
    }

    const min = minCacheableTokens(site.provider, site.model);
    if (min === null) continue;

    const cacheable = cacheablePrefixTokens(site);
    if (cacheable < floor) continue;

    if (cacheable < min) {
      // Only worth mentioning if it is in the same ballpark as the minimum.
      if (cacheable >= min / 2) {
        belowMinimum.push({
          file: site.file,
          line: site.line,
          model: site.model,
          tokens: cacheable,
          minCacheableTokens: min,
        });
      }
      continue;
    }

    // Savings per repeat call = the prefix, billed at base minus the read rate.
    const perToken = site.cost.pricePerMTok !== null ? site.cost.pricePerMTok / 1_000_000 : null;
    const savingsPerCallUsd =
      perToken !== null ? cacheable * perToken * (1 - CACHE_READ_MULTIPLIER) : null;

    const norm = normalizeText(site.prompt.parts.map((p) => p.value.text).join('\n'));
    const shared = (byText.get(norm) ?? []).filter((r) => r.file !== site.file || r.line !== site.line);

    opportunities.push({
      file: site.file,
      line: site.line,
      model: site.model,
      cacheableTokens: cacheable,
      minCacheableTokens: min,
      savingsPerCallUsd,
      sharedWith: shared,
    });
  }

  opportunities.sort((a, b) => (b.savingsPerCallUsd ?? 0) - (a.savingsPerCallUsd ?? 0) || b.cacheableTokens - a.cacheableTokens);
  belowMinimum.sort((a, b) => b.tokens - a.tokens);

  const totalSavingsPerCallUsd = opportunities.reduce((sum, o) => sum + (o.savingsPerCallUsd ?? 0), 0);

  return { opportunities, cachedSites, belowMinimum, skippedUnknownModel, totalSavingsPerCallUsd };
}
