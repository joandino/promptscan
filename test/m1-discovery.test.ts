import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleRepo = path.join(here, 'fixtures', 'sample-repo');

test('discovers python files and ignores vendored/cache dirs', async () => {
  const report = await scan(sampleRepo);
  // openai_call.py, agents/anthropic_call.py, utils.py, broken.py — but NOT
  // __pycache__/junk.py, .venv/lib/vendored.py, or README.md.
  assert.equal(report.stats.discovered, 4);
  const rels = report.files.map((f) => f.relPath).sort();
  assert.deepEqual(rels, [
    'agents/anthropic_call.py',
    'broken.py',
    'openai_call.py',
    'utils.py',
  ]);
});

test('parses clean files clean and broken files as recoverable partials', async () => {
  const report = await scan(sampleRepo);
  assert.equal(report.stats.parsedClean, 3);
  assert.equal(report.stats.parsedPartial, 1);
  assert.equal(report.stats.readErrors, 0);
  const broken = report.files.find((f) => f.relPath === 'broken.py');
  assert.equal(broken?.status, 'partial');
});

test('a single .py file target scans just that file', async () => {
  const report = await scan(path.join(sampleRepo, 'utils.py'));
  assert.equal(report.stats.discovered, 1);
  assert.equal(report.stats.parsedClean, 1);
});

test('a non-python file target yields zero files', async () => {
  const report = await scan(path.join(sampleRepo, 'README.md'));
  assert.equal(report.stats.discovered, 0);
});

test('missing path rejects', async () => {
  await assert.rejects(() => scan(path.join(sampleRepo, 'nope')), /path not found/);
});
