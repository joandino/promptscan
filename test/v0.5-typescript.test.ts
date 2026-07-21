import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const tsRepo = path.join(here, 'fixtures', 'ts-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

test('detects TS/JS call sites across ESM, named, CJS, and JSX', async () => {
  const { callSites, stats } = await scan(tsRepo);
  assert.equal(stats.callSites, 5);
  assert.equal(callSites.filter((s) => s.provider === 'openai').length, 4);
  assert.equal(callSites.filter((s) => s.provider === 'anthropic').length, 1);
});

test('does not flag Twilio client.messages.create() in JS', async () => {
  const { callSites } = await scan(tsRepo);
  assert.equal(callSites.find((s) => s.file === 'twilio_like.js'), undefined);
});

test('binds clients from default import, named import, and require', async () => {
  const { callSites } = await scan(tsRepo);
  assert.equal(byFile(callSites, 'openai_esm.ts').basis, 'binding'); // import OpenAI from 'openai'
  assert.equal(byFile(callSites, 'anthropic_named.ts').basis, 'binding'); // import { Anthropic }
  assert.equal(byFile(callSites, 'openai_cjs.js').basis, 'binding'); // require('openai')
});

test('extracts models from the object-literal argument', async () => {
  const { callSites } = await scan(tsRepo);
  assert.equal(byFile(callSites, 'openai_esm.ts').model, 'gpt-4o');
  assert.equal(byFile(callSites, 'anthropic_named.ts').model, 'claude-sonnet-5');
  assert.equal(byFile(callSites, 'openai_cjs.js').model, 'gpt-4.1');
  assert.equal(byFile(callSites, 'openai_jsx.jsx').model, 'gpt-4o-mini');
});

test('resolves string constants and message contents', async () => {
  const { callSites } = await scan(tsRepo);
  const anthropic = byFile(callSites, 'anthropic_named.ts');
  assert.equal(anthropic.prompt.status, 'resolved');
  const systemPart = anthropic.prompt.parts.find((p) => p.origin === 'system');
  assert.equal(systemPart?.value.text, 'You are a helpful reviewer.');

  // SYS constant resolves in the ESM file
  const esm = byFile(callSites, 'openai_esm.ts');
  const sys = esm.prompt.parts.find((p) => p.role === 'system');
  assert.match(sys?.value.text ?? '', /precise assistant/);

  // responses.create input resolves
  const cjs = byFile(callSites, 'openai_cjs.js');
  assert.equal(cjs.prompt.status, 'resolved');
  assert.match(cjs.prompt.parts[0].value.text, /Summarize the release/);
});

test('template literals are partial; dynamic model/messages are unresolved', async () => {
  const { callSites } = await scan(tsRepo);
  const esm = byFile(callSites, 'openai_esm.ts');
  assert.equal(esm.prompt.status, 'partial'); // user content is `Please answer: ${q}`
  const user = esm.prompt.parts.find((p) => p.role === 'user');
  assert.equal(user?.value.text, 'Please answer: ');

  const dyn = byFile(callSites, 'dynamic.ts');
  assert.equal(dyn.modelResolved, false);
  assert.equal(dyn.modelHint, 'model');
  assert.equal(dyn.prompt.status, 'unresolved');
});
