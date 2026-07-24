import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite, ResolvedPrompt } from '../src/report/types.ts';
import { resolveEncoding } from '../src/tokens/models.ts';
import { estimateTokens, countTokens } from '../src/tokens/tokenizer.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'resolve-repo');

function site(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

function literalPrompt(text: string, role = 'user'): ResolvedPrompt {
  return {
    status: 'resolved',
    parts: [
      { role, origin: 'messages', value: { status: 'resolved', text, segments: [{ kind: 'static', text }], source: 'literal' } },
    ],
  };
}

test('encoding selection by provider/model', () => {
  assert.deepEqual(resolveEncoding('openai', 'gpt-4o'), { encoding: 'o200k_base', matched: true });
  assert.deepEqual(resolveEncoding('openai', 'gpt-4o-mini'), { encoding: 'o200k_base', matched: true });
  assert.deepEqual(resolveEncoding('openai', 'gpt-4.1'), { encoding: 'o200k_base', matched: true });
  assert.deepEqual(resolveEncoding('openai', 'gpt-4-turbo'), { encoding: 'cl100k_base', matched: true });
  assert.deepEqual(resolveEncoding('openai', 'gpt-3.5-turbo'), { encoding: 'cl100k_base', matched: true });
  // unknown model → fallback, flagged
  assert.deepEqual(resolveEncoding('openai', 'mystery-9'), { encoding: 'o200k_base', matched: false });
  // anthropic → proxy, intentional (not a fallback)
  assert.deepEqual(resolveEncoding('anthropic', 'claude-sonnet-5'), { encoding: 'cl100k_base', matched: true });
});

test('countTokens is deterministic for a known string', () => {
  assert.equal(countTokens('Hello, world!', 'o200k_base'), 4);
  assert.equal(countTokens('', 'o200k_base'), 0);
});

test('estimate = content + overhead, with priming and role', () => {
  const est = estimateTokens('openai', 'gpt-4o', literalPrompt('Hello, world!'));
  assert.equal(est.contentTokens, 4);
  assert.equal(est.inputTokens, est.contentTokens + est.overheadTokens);
  assert.ok(est.overheadTokens >= 6, 'includes per-message + priming'); // 3 + role + 3
  assert.equal(est.approximate, false);
  assert.equal(est.encoding, 'o200k_base');
});

test('anthropic estimates are flagged approximate and name the tokenizer family', () => {
  const est = estimateTokens('anthropic', 'claude-sonnet-5', literalPrompt('Hello, world!'));
  assert.equal(est.approximate, true);
  assert.match(est.encoding, /anthropic newer-tokenizer/);
  assert.ok(est.notes.some((n) => /no public tokenizer/.test(n)));
});

test('unknown model estimate is approximate and notes the fallback', () => {
  const est = estimateTokens('openai', 'mystery-9', literalPrompt('Hello, world!'));
  assert.equal(est.approximate, true);
  assert.ok(est.notes.some((n) => /assumed o200k_base/.test(n)));
});

test('call sites carry token estimates; content=0 when unresolved', async () => {
  const { callSites } = await scan(repo);

  const openai = site(callSites, 'literal_messages.py');
  assert.equal(openai.tokens.approximate, false);
  assert.ok(openai.tokens.contentTokens > 0);

  const anthropic = site(callSites, 'file_prompt.py');
  assert.equal(anthropic.tokens.approximate, true);

  const partial = site(callSites, 'fstring_prompt.py');
  assert.ok(partial.tokens.contentTokens > 0);
  assert.ok(partial.tokens.notes.some((n) => /floor/.test(n)));

  const unresolved = site(callSites, 'dynamic_messages.py');
  assert.equal(unresolved.tokens.contentTokens, 0);
});

test('stats.inputTokens sums only countable call sites', async () => {
  const { callSites, stats } = await scan(repo);
  const expected = callSites
    .filter((s) => s.prompt.status !== 'unresolved')
    .reduce((n, s) => n + s.tokens.inputTokens, 0);
  assert.equal(stats.inputTokens, expected);
  assert.equal(stats.tokensApproximate, true); // anthropic call sites present
});
