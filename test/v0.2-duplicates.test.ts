import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dupRepo = path.join(here, 'fixtures', 'dup-repo');
const shortRepo = path.join(here, 'fixtures', 'stream-parse-repo');

function locs(sites: { file: string; line: number }[]): string[] {
  return sites.map((s) => `${s.file}:${s.line}`).sort();
}

test('finds exact duplicates across constant and inline literal', async () => {
  const { duplicates } = await scan(dupRepo);
  assert.equal(duplicates.exact.length, 1);
  // agent_a uses a SYS constant, agent_b an inline literal — same resolved text.
  assert.deepEqual(locs(duplicates.exact[0].sites), ['agent_a.py:4', 'agent_b.py:4']);
});

test('finds near-duplicates above threshold, not the unique prompt', async () => {
  const { duplicates } = await scan(dupRepo);
  assert.equal(duplicates.near.length, 1);
  assert.ok(duplicates.near[0].similarity >= 0.85);
  const involved = [duplicates.near[0].a.file, duplicates.near[0].b.file].sort();
  assert.deepEqual(involved, ['agent_a.py', 'agent_c.py']);
  // The French-translation prompt shares few words → never flagged.
  const files = duplicates.near.flatMap((p) => [p.a.file, p.b.file]);
  assert.ok(!files.includes('unique.py'));
});

test('similarity threshold is configurable', async () => {
  const strict = await scan(dupRepo, { threshold: 0.99 });
  assert.equal(strict.duplicates.near.length, 0); // 0.94 pair now excluded
  assert.equal(strict.duplicates.exact.length, 1); // exact unaffected
  assert.equal(strict.duplicates.threshold, 0.99);
});

test('trivially short prompts are excluded from duplicate analysis', async () => {
  // stream-parse-repo prompts ("hi", "parse me", …) are under the word floor.
  const { duplicates } = await scan(shortRepo);
  assert.equal(duplicates.exact.length, 0);
  assert.equal(duplicates.near.length, 0);
});

test('report carries a structured duplicates block and stats', async () => {
  const report = await scan(dupRepo);
  assert.ok(report.duplicates);
  assert.equal(report.stats.exactDuplicateGroups, report.duplicates.exact.length);
  assert.equal(report.stats.nearDuplicatePairs, report.duplicates.near.length);
  // Whole report must be JSON-serializable (the --format json path).
  assert.doesNotThrow(() => JSON.stringify(report));
});
