import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';
import { resolvePricing } from '../src/pricing/table.ts';
import { estimateCost } from '../src/pricing/cost.ts';
import { loadVolumeConfig } from '../src/pricing/volume.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const costRepo = path.join(here, 'fixtures', 'cost-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

test('pricing lookup: exact, prefix, unknown, provider-mismatch', () => {
  assert.equal(resolvePricing('openai', 'gpt-4o')?.inputPerMTok, 2.5);
  assert.equal(resolvePricing('anthropic', 'claude-sonnet-5')?.inputPerMTok, 3);
  // dated snapshot resolves via prefix rule
  assert.equal(resolvePricing('openai', 'gpt-4o-2024-08-06')?.id, 'gpt-4o');
  // unknown model → no price
  assert.equal(resolvePricing('openai', 'totally-made-up'), null);
  // an OpenAI model asked for under the anthropic provider → no price
  assert.equal(resolvePricing('anthropic', 'gpt-4o'), null);
});

test('cost = tokens × per-MTok price', () => {
  const c = estimateCost('openai', 'gpt-4o', 1_000_000);
  assert.equal(c.inputCostUsd, 2.5);
  assert.equal(c.pricePerMTok, 2.5);
  assert.equal(c.pricedAs, 'gpt-4o');
});

test('unknown model yields a null cost, counted as unpriced', () => {
  const c = estimateCost('openai', 'some-unlisted-model-x1', 1000);
  assert.equal(c.inputCostUsd, null);
  assert.equal(c.pricedAs, null);
});

test('call sites carry per-call cost; stats sum only priced sites', async () => {
  const { callSites, stats } = await scan(costRepo);
  const known = byFile(callSites, 'known.py');
  const unknown = byFile(callSites, 'unknown.py');

  // known.py is gpt-4o → cost = tokens/1e6 * 2.5
  assert.ok(known.cost.inputCostUsd !== null);
  assert.ok(Math.abs(known.cost.inputCostUsd - (known.tokens.inputTokens / 1_000_000) * 2.5) < 1e-12);

  assert.equal(unknown.cost.inputCostUsd, null);
  assert.equal(stats.unpricedCallSites, 1);
  assert.ok(Math.abs(stats.inputCostUsd - known.cost.inputCostUsd) < 1e-12);
});

test('report carries pricing version/as-of metadata', async () => {
  const { meta } = await scan(costRepo);
  assert.match(meta.pricingVersion, /^\d{4}\.\d{2}$/);
  assert.match(meta.pricingAsOf, /^\d{4}-\d{2}-\d{2}$/);
});

test('monthly projection scales per-call cost by call volume', async () => {
  const volume = { default: 100, sites: { 'known.py:3': 5000 } };
  const { callSites, projection } = await scan(costRepo, { volume });
  assert.ok(projection);

  const known = byFile(callSites, 'known.py');
  const knownProj = projection.sites.find((s) => s.file === 'known.py');
  assert.equal(knownProj?.callsPerMonth, 5000);
  assert.ok(Math.abs((knownProj?.monthlyInputCostUsd ?? 0) - known.cost.inputCostUsd! * 5000) < 1e-9);

  // unknown.py uses the default volume but is unpriced → excluded from the total
  assert.equal(projection.unpriced, 1);
  assert.ok(Math.abs(projection.monthlyInputCostUsd - known.cost.inputCostUsd! * 5000) < 1e-9);
});

test('loadVolumeConfig parses YAML and rejects malformed input', () => {
  const cfg = loadVolumeConfig(path.join(costRepo, 'volume.yaml'));
  assert.equal(cfg.default, 100);
  assert.equal(cfg.sites?.['known.py:3'], 5000);
  assert.throws(() => loadVolumeConfig(path.join(costRepo, 'does-not-exist.yaml')), /not found/);
});
