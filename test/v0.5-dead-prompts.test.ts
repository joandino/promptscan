import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'dead-repo');

test('flags only prompt constants with no reachable reference', async () => {
  const { deadPrompts } = await scan(repo);
  const names = deadPrompts.map((d) => d.name).sort();
  assert.deepEqual(names, ['DEAD_PROMPT', 'TS_DEAD']);
  assert.ok(deadPrompts.every((d) => d.tokens > 0));
});

test('does not flag cross-file-imported, exported, dynamic, or short constants', async () => {
  const { deadPrompts } = await scan(repo);
  const flagged = new Set(deadPrompts.map((d) => d.name));
  assert.ok(!flagged.has('USED_PROMPT'), 'imported in agent.py'); // cross-file reference
  assert.ok(!flagged.has('EXPORTED_PROMPT'), 'in __all__'); // appears in a string literal
  assert.ok(!flagged.has('DYNAMIC_PROMPT'), 'getattr access'); // appears in a string literal
  assert.ok(!flagged.has('VERSION'), 'too short to be a prompt');
  assert.ok(!flagged.has('TS_USED'), 'referenced by console.log');
});

test('deadPrompts count matches the array and appears in stats', async () => {
  const report = await scan(repo);
  assert.equal(report.stats.deadPrompts, report.deadPrompts.length);
  assert.equal(report.stats.deadPrompts, 2);
});
