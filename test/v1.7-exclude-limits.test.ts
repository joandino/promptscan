import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import { normalizeExcludes } from '../src/discovery/walk.ts';
import { checkLimits } from '../src/report/limits.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'exclude-repo');
const cachingRepo = path.join(here, 'fixtures', 'caching-repo');

const files = (r: { files: { relPath: string }[] }) => r.files.map((f) => f.relPath).sort();

test('a bare exclude name matches at any depth, like .gitignore', async () => {
  const before = await scan(repo);
  assert.ok(files(before).includes('website/_includes/chart.js'));
  assert.ok(files(before).includes('app/website/helper.py'), 'nested website dir is scanned by default');

  const after = await scan(repo, { exclude: ['website'] });
  const got = files(after);
  assert.ok(!got.some((f) => f.includes('website')), `expected no website paths, got ${got.join(', ')}`);
  // Everything else survives.
  assert.ok(got.includes('app/main.py'));
  assert.ok(got.includes('vendor/nested/lib.py'));
});

test('an exclude containing a slash is anchored at the scan root', async () => {
  // `app/website` must skip only the nested one, leaving top-level website/ alone.
  const r = await scan(repo, { exclude: ['app/website'] });
  const got = files(r);
  assert.ok(!got.includes('app/website/helper.py'), 'anchored path is excluded');
  assert.ok(got.includes('website/_includes/chart.js'), 'top-level website/ is untouched');
});

test('a glob exclude is passed through untouched', async () => {
  const r = await scan(repo, { exclude: ['**/*.js'] });
  const got = files(r);
  assert.ok(!got.some((f) => f.endsWith('.js')));
  assert.ok(got.includes('app/main.py'));
});

test('excluding a path removes its call sites from the totals', async () => {
  const before = await scan(repo);
  const after = await scan(repo, { exclude: ['vendor'] });
  assert.ok(after.stats.callSites < before.stats.callSites, 'vendor call site is dropped');
  assert.ok(!after.callSites.some((s) => s.file.startsWith('vendor/')));
});

test('normalizeExcludes expands bare names and anchors paths', () => {
  assert.deepEqual(normalizeExcludes(['website']), ['**/website', '**/website/**']);
  assert.deepEqual(normalizeExcludes(['src/generated']), ['src/generated', 'src/generated/**']);
  assert.deepEqual(normalizeExcludes(['**/*.test.py']), ['**/*.test.py']);
  // Trailing slashes and blank entries are tolerated.
  assert.deepEqual(normalizeExcludes(['vendor/', '  ', '']), ['**/vendor', '**/vendor/**']);
});

test('limits pass when under and report each violation when over', async () => {
  const report = await scan(cachingRepo);
  assert.ok(report.stats.inputCostUsd > 0, 'fixture has priced call sites');

  assert.deepEqual(checkLimits(report, {}), [], 'no limits configured means no violations');
  assert.deepEqual(checkLimits(report, { maxTotalCostUsd: 100 }), []);

  const overCost = checkLimits(report, { maxTotalCostUsd: 0.0001 });
  assert.equal(overCost.length, 1);
  assert.equal(overCost[0]?.limit, 'maxTotalCostUsd');

  const overTotal = checkLimits(report, { maxTotalTokens: 10 });
  assert.equal(overTotal.length, 1);
  assert.equal(overTotal[0]?.limit, 'maxTotalTokens');

  // Per-prompt limits report every offending site, not just the first.
  const overPrompt = checkLimits(report, { maxPromptTokens: 2000 });
  assert.ok(overPrompt.length > 1);
  assert.ok(overPrompt.every((v) => v.limit === 'maxPromptTokens'));
  assert.match(overPrompt[0]?.message ?? '', /\.py:\d+/);
});

test('an unresolved prompt cannot trip a per-prompt token limit', async () => {
  const report = await scan(cachingRepo);
  // Counts cover static content only, so a limit of 0 still only flags sites
  // with countable content — never an unresolved one.
  const violations = checkLimits(report, { maxPromptTokens: 0 });
  const flagged = new Set(violations.map((v) => v.message.split(' ')[0]));
  for (const site of report.callSites) {
    if (site.prompt.status === 'unresolved') {
      assert.ok(!flagged.has(`${site.file}:${site.line}`), 'unresolved sites are never gated');
    }
  }
});
