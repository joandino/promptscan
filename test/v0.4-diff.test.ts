import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scan } from '../src/index.ts';
import { computeDiff, exceedsIncrease } from '../src/diff/diff.ts';
import { runDiff } from '../src/diff/run.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.join(here, 'fixtures', 'diff-base');
const headDir = path.join(here, 'fixtures', 'diff-head');

test('computeDiff reports totals delta and new/removed prompts', async () => {
  const base = await scan(baseDir);
  const head = await scan(headDir);
  const diff = computeDiff(base, head);

  assert.equal(diff.totals.base.callSites, 2);
  assert.equal(diff.totals.head.callSites, 2);
  assert.equal(diff.totals.tokenDelta, head.stats.inputTokens - base.stats.inputTokens);

  // 'new.py' prompt is absent from base; 'keep.py' is shared → not new.
  const newFiles = diff.newPrompts.map((s) => s.file).sort();
  assert.deepEqual(newFiles, ['new.py']);
  // 'gone.py' prompt is absent from head.
  const removedFiles = diff.removedPrompts.map((s) => s.file).sort();
  assert.deepEqual(removedFiles, ['gone.py']);
});

test('exceedsIncrease gates on the chosen metric', () => {
  const base = { stats: { inputTokens: 100, inputCostUsd: 0.001, callSites: 1 }, callSites: [], meta: {} } as never;
  const head = { stats: { inputTokens: 150, inputCostUsd: 0.001, callSites: 1 }, callSites: [], meta: { version: '', pricingVersion: '', pricingAsOf: '' } } as never;
  const diff = computeDiff(base, head);
  assert.equal(diff.totals.tokenPct, 50);
  assert.equal(exceedsIncrease(diff, 'tokens', 5), true); // 50% > 5%
  assert.equal(exceedsIncrease(diff, 'tokens', 60), false); // 50% <= 60%
  assert.equal(exceedsIncrease(diff, 'cost', 5), false); // cost unchanged
});

test('null base (zero tokens) yields null percent, never a divide-by-zero', async () => {
  const empty = await scan(path.join(here, 'fixtures')); // no direct .py at this level resolve → still fine
  const head = await scan(headDir);
  const diff = computeDiff({ ...empty, stats: { ...empty.stats, inputTokens: 0, inputCostUsd: 0 } } as never, head);
  assert.equal(diff.totals.tokenPct, null);
  assert.equal(exceedsIncrease(diff, 'tokens', 5), false);
});

test('runDiff materializes two git refs and detects the added prompt', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'promptscan-difftest-'));
  try {
    const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t.co');
    g('config', 'user.name', 't');
    mkdirSync(path.join(repo, 'src'));

    const call = (content: string) =>
      `import openai\nclient = openai.OpenAI()\nclient.chat.completions.create(model="gpt-4o", messages=[{"role":"system","content":"${content}"}])\n`;

    writeFileSync(path.join(repo, 'src', 'a.py'), call('You are a careful assistant that always cites the exact source lines for every claim.'));
    g('add', '-A');
    g('commit', '-q', '-m', 'base');

    writeFileSync(path.join(repo, 'src', 'b.py'), call('You draft concise weekly status updates from a list of completed engineering tasks.'));
    g('add', '-A');
    g('commit', '-q', '-m', 'head');

    const { diff, failed } = await runDiff('HEAD~1', 'HEAD', 'src', repo, {
      failOnIncreasePct: 5,
      metric: 'tokens',
    });

    assert.equal(diff.totals.base.callSites, 1);
    assert.equal(diff.totals.head.callSites, 2);
    assert.equal(diff.newPrompts.length, 1);
    assert.equal(diff.newPrompts[0].file, 'b.py');
    assert.ok(diff.totals.tokenDelta > 0);
    assert.equal(failed, true); // token increase far exceeds 5%
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
