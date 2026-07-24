import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from '../src/tokens/tokenizer.ts';
import { anthropicTokenizer, anthropicCalibration } from '../src/tokens/models.ts';
import type { ResolvedPrompt } from '../src/report/types.ts';

function literalPrompt(text: string): ResolvedPrompt {
  return {
    status: 'resolved',
    parts: [
      {
        role: 'user',
        origin: 'messages',
        value: { status: 'resolved', text, segments: [{ kind: 'static', text }], source: 'literal' },
        cacheControl: false,
      },
    ],
  };
}

test('models are mapped to the right tokenizer family', () => {
  // Opus 4.7 and later Opus, Sonnet 5, Fable 5, and Mythos use the newer one.
  for (const m of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5', 'claude-mythos-5']) {
    assert.equal(anthropicTokenizer(m), 'newer', `${m} should be newer`);
  }
  // Opus 4.6 and earlier, and the Sonnet 4.x / Haiku lines, use the previous one.
  for (const m of ['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
    assert.equal(anthropicTokenizer(m), 'previous', `${m} should be previous`);
  }
  // Dated snapshots resolve by prefix.
  assert.equal(anthropicTokenizer('claude-sonnet-5-20260101'), 'newer');
});

test('an unrecognized anthropic model is assumed to use the newer tokenizer', () => {
  // Unknown strings are usually models newer than this table, and every Claude
  // release since Opus 4.7 uses the newer tokenizer.
  assert.equal(anthropicTokenizer('claude-something-unreleased'), 'newer');
  assert.equal(anthropicTokenizer(null), 'newer');
});

test('the newer tokenizer is corrected upward; the previous one is left alone', () => {
  assert.equal(anthropicCalibration('claude-sonnet-4-6'), 1);
  assert.ok(anthropicCalibration('claude-opus-4-8') > 1.3);
});

test('the same prompt costs materially more tokens on a newer-tokenizer model', () => {
  const prompt = literalPrompt(
    'You are a meticulous senior support engineer. Answer precisely, cite the relevant policy section, and never invent a refund amount.',
  );
  const prev = estimateTokens('anthropic', 'claude-sonnet-4-6', prompt);
  const next = estimateTokens('anthropic', 'claude-opus-4-8', prompt);

  assert.ok(
    next.contentTokens > prev.contentTokens * 1.3,
    `expected the newer tokenizer to produce materially more tokens (${prev.contentTokens} -> ${next.contentTokens})`,
  );
  // Both remain labeled as estimates — the calibration does not imply exactness.
  assert.equal(prev.approximate, true);
  assert.equal(next.approximate, true);
});

test('the note states whether a correction was applied', () => {
  const prompt = literalPrompt('Summarize the following support ticket in one sentence.');

  const prev = estimateTokens('anthropic', 'claude-sonnet-4-6', prompt);
  assert.ok(prev.notes.some((n) => /previous tokenizer/.test(n)));
  assert.ok(!prev.notes.some((n) => /scaled x/.test(n)), 'no correction is claimed when none is applied');

  const next = estimateTokens('anthropic', 'claude-opus-4-8', prompt);
  assert.ok(next.notes.some((n) => /scaled x1\.43/.test(n)));
  assert.match(next.encoding, /x1\.43/);
});

test('non-anthropic providers are untouched by the calibration', () => {
  const prompt = literalPrompt('Classify this ticket by urgency.');
  const openai = estimateTokens('openai', 'gpt-4o', prompt);
  const other = estimateTokens('other', 'llama-3-70b', prompt);
  assert.ok(!openai.encoding.includes('anthropic'));
  assert.ok(!other.encoding.includes('anthropic'));
  assert.ok(!openai.notes.some((n) => /scaled/.test(n)));
});

test('legacy models are not swept into the newer family by the fallback', () => {
  // The Claude 3 line predates the newer tokenizer; inflating it by 43% would
  // be a worse error than the one this calibration exists to fix.
  for (const m of ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku']) {
    assert.equal(anthropicTokenizer(m), 'previous', `${m} should be previous`);
  }
});
