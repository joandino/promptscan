import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'bloat-repo');

test('flags oversized prompts above the token threshold', async () => {
  const { bloat } = await scan(repo);
  const o = bloat.oversized.find((x) => x.file === 'oversized.py');
  assert.ok(o, 'oversized.py should be flagged');
  assert.ok(o.tokens >= bloat.thresholds.largeTokens);
});

test('flags many-message (few-shot) prompts', async () => {
  const { bloat } = await scan(repo);
  const f = bloat.fewShot.find((x) => x.file === 'fewshot.py');
  assert.ok(f, 'fewshot.py should be flagged');
  assert.ok(f.messageCount >= bloat.thresholds.manyMessages);
});

test('flags boilerplate blocks shared across call sites (part-level)', async () => {
  const { bloat } = await scan(repo);
  // The system prompt is shared by agent1/2/3 whose user turns differ — whole-prompt
  // dedup would miss it, but part-level boilerplate catches it.
  const block = bloat.boilerplate.find((b) => /meticulous senior support engineer/.test(b.text));
  assert.ok(block, 'shared system prompt should be flagged as boilerplate');
  assert.equal(block.sites.length, 3);
  assert.ok(block.tokens > 0);
});

test('stats.bloatFlags totals the three heuristics', async () => {
  const report = await scan(repo);
  const { oversized, fewShot, boilerplate } = report.bloat;
  assert.equal(report.stats.bloatFlags, oversized.length + fewShot.length + boilerplate.length);
});

test('thresholds are configurable', async () => {
  const strict = await scan(repo, { largeTokens: 100_000, boilerplateMinSites: 4 });
  assert.equal(strict.bloat.oversized.length, 0); // nothing reaches 100k
  assert.equal(strict.bloat.boilerplate.length, 0); // only 3 sites share the block
  assert.equal(strict.bloat.thresholds.largeTokens, 100_000);
});
