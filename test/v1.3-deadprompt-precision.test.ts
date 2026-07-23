import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import { isTestPath, looksLikePrompt } from '../src/analyze/deadprompts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'deadprompt-precision-repo');

test('flags a real dead prompt but not art / error-named / test-file / TS-test constants', async () => {
  const { deadPrompts } = await scan(repo);
  const names = deadPrompts.map((d) => d.name).sort();

  // Genuinely-unused prose constants are still flagged (Python + TS).
  assert.ok(names.includes('REAL_DEAD_PROMPT'), 'REAL_DEAD_PROMPT should be flagged');
  assert.ok(names.includes('TS_DEAD_PROMPT'), 'TS_DEAD_PROMPT should be flagged');

  // The false-positive classes are now suppressed.
  assert.ok(!names.includes('SPLASH_SCREEN'), 'ASCII art must not be flagged (letter ratio)');
  assert.ok(!names.includes('FOUND_MULTIPLE_STRINGS_ERROR'), 'error-named const must not be flagged');
  assert.ok(!names.includes('MOCK_SYSTEM_PROMPT'), 'test-file const must not be flagged');
  assert.ok(!names.includes('TS_MOCK_PROMPT'), '*.test.ts const must not be flagged');

  assert.equal(deadPrompts.length, 2);
});

test('isTestPath recognizes common test/mock/fixture locations', () => {
  for (const p of [
    'tests/test_core.py',
    'pkg/__tests__/thing.ts',
    'src/foo.test.ts',
    'src/foo.spec.tsx',
    'a/b/conftest.py',
    'test_helpers.py',
    'helpers_test.py',
    'mock_client.py',
    'fixtures/data.py',
  ]) {
    assert.ok(isTestPath(p), `${p} should be a test path`);
  }
  for (const p of ['src/agents/support.py', 'lib/prompts.ts', 'app/latest_news.py']) {
    assert.ok(!isTestPath(p), `${p} should NOT be a test path`);
  }
});

test('looksLikePrompt accepts prose and rejects art / blobs / bad names', () => {
  assert.ok(looksLikePrompt('You are a careful assistant that answers billing questions.', 'SUPPORT_PROMPT'));
  assert.ok(!looksLikePrompt('|.|/ __ ||| === +++ *** ~~~ <><> ///', 'SPLASH'));
  assert.ok(!looksLikePrompt('You are a helpful assistant for the app.', 'APP_LOGO_ASCII'));
  assert.ok(!looksLikePrompt('Could not connect to the upstream service right now.', 'CONNECT_ERROR'));
});
