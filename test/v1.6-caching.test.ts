import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import { minCacheableTokens, CONSERVATIVE_MIN_CACHEABLE } from '../src/pricing/caching.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'caching-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

test('a cache_control block marks the prefix as cached and is priced at the read rate', async () => {
  const { callSites } = await scan(repo);
  const cached = byFile(callSites, 'cached.py');

  assert.ok(cached.tokens.cachedTokens > 2000, 'the system prompt sits in the cached prefix');
  assert.ok(cached.prompt.parts.some((p) => p.cacheControl), 'the breakpoint is recorded on the part');

  // Steady-state cost must be far below the uncached baseline — that gap is the
  // whole point of the feature. Cache read is 0.1x base.
  assert.ok(cached.cost.inputCostUsd !== null && cached.cost.uncachedInputCostUsd !== null);
  assert.ok(
    cached.cost.inputCostUsd < cached.cost.uncachedInputCostUsd / 5,
    'a cached prefix should cost dramatically less than the uncached baseline',
  );
  // The first call pays the 1.25x write premium, so it exceeds the baseline.
  assert.ok(cached.cost.cacheWriteCostUsd !== null);
  assert.ok(cached.cost.cacheWriteCostUsd > cached.cost.uncachedInputCostUsd);
});

test('an uncached prompt over the model minimum is reported as an opportunity', async () => {
  const { caching, stats } = await scan(repo);
  const opp = caching.opportunities.find((o) => o.file === 'uncached.py');
  assert.ok(opp, 'the large uncached Anthropic prompt should be flagged');
  assert.equal(opp.model, 'claude-opus-4-8');
  assert.equal(opp.minCacheableTokens, 1024);
  assert.ok(opp.cacheableTokens >= opp.minCacheableTokens);
  assert.ok(opp.savingsPerCallUsd !== null && opp.savingsPerCallUsd > 0);
  // cached.py sends the identical prompt, so they share one cache entry.
  assert.equal(opp.sharedWith.length, 1);
  assert.equal(opp.sharedWith[0]?.file, 'cached.py');

  assert.equal(stats.cacheOpportunities, 1);
  assert.equal(stats.cachedCallSites, 1);
  assert.ok(stats.cacheSavingsPerCallUsd > 0);
});

test('an identical prompt below its model minimum is never recommended', async () => {
  const { caching } = await scan(repo);
  // too_small.py sends the SAME text as uncached.py but on Haiku 4.5, whose
  // minimum is 4,096 — a cache_control there would be silently ignored.
  assert.ok(
    !caching.opportunities.some((o) => o.file === 'too_small.py'),
    'must not recommend caching below the model minimum',
  );
  const below = caching.belowMinimum.find((b) => b.file === 'too_small.py');
  assert.ok(below, 'it should still be surfaced as below-minimum, not silently dropped');
  assert.equal(below.model, 'claude-haiku-4-5');
  assert.equal(below.minCacheableTokens, 4096);
});

test('a large static block behind a runtime turn is not a cacheable prefix', async () => {
  const { callSites, caching } = await scan(repo);
  const dyn = byFile(callSites, 'dynamic_prefix.py');
  // Plenty of static content overall...
  assert.ok(dyn.tokens.contentTokens > 2000);
  // ...but the first message is a runtime value, so no stable prefix exists.
  assert.equal(dyn.prompt.parts[0]?.value.status, 'unresolved');
  assert.ok(
    !caching.opportunities.some((o) => o.file === 'dynamic_prefix.py'),
    'a cache breakpoint only covers a contiguous prefix identical across calls',
  );
});

test('OpenAI sites are out of scope — caching there is automatic', async () => {
  const { caching, callSites } = await scan(repo);
  const oai = byFile(callSites, 'openai_big.py');
  assert.equal(oai.tokens.cachedTokens, 0);
  // Same prompt size as the flagged Anthropic site, deliberately not flagged.
  assert.ok(!caching.opportunities.some((o) => o.file === 'openai_big.py'));
  assert.ok(!caching.belowMinimum.some((b) => b.file === 'openai_big.py'));
});

test('per-model cache minimums match the published table', () => {
  assert.equal(minCacheableTokens('anthropic', 'claude-opus-4-8'), 1024);
  assert.equal(minCacheableTokens('anthropic', 'claude-opus-4-7'), 2048);
  assert.equal(minCacheableTokens('anthropic', 'claude-haiku-4-5'), 4096);
  assert.equal(minCacheableTokens('anthropic', 'claude-fable-5'), 512);
  assert.equal(minCacheableTokens('anthropic', 'claude-sonnet-5'), 1024);

  // An unknown Anthropic model falls back to the most conservative minimum, so
  // we under-recommend rather than give advice the API would ignore.
  assert.equal(minCacheableTokens('anthropic', 'claude-something-new'), CONSERVATIVE_MIN_CACHEABLE);

  // Caching analysis does not apply to non-Anthropic providers.
  assert.equal(minCacheableTokens('openai', 'gpt-4o'), null);
  assert.equal(minCacheableTokens('anthropic', null), null);
});
