import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'stream-parse-repo');

test('detects stream() and parse() variants across families', async () => {
  const { callSites } = await scan(repo);
  const methods = callSites.map((s) => `${s.provider}:${s.method}`).sort();
  assert.deepEqual(methods, [
    'anthropic:messages.stream',
    'openai:chat.completions.parse',
    'openai:chat.completions.stream',
    'openai:responses.stream',
  ]);
});

test('stream/parse variants resolve prompts like create', async () => {
  const { callSites } = await scan(repo);
  // Every detected call here has literal prompt content.
  assert.ok(callSites.every((s) => s.prompt.status === 'resolved'));
  const parse = callSites.find((s) => s.method === 'chat.completions.parse');
  assert.equal(parse?.prompt.parts[0].value.text, 'parse me');
});

test('does not flag Twilio client.messages.stream()', async () => {
  const { callSites } = await scan(repo);
  assert.equal(callSites.find((s) => s.file === 'twilio_stream.py'), undefined);
});
