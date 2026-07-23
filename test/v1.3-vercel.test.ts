import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'vercel-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

const systemText = (s: CallSite) => s.prompt.parts.find((p) => p.role === 'system')?.value.text;

test('detects the Vercel AI SDK generate/stream entrypoints', async () => {
  const { callSites, stats } = await scan(repo);
  // generate_text, stream_anthropic, generate_object, google_other, custom_instance,
  // variable_model — but NOT not_vercel.ts.
  assert.equal(stats.callSites, 6);
  assert.ok(callSites.every((s) => s.method.startsWith('ai.')));
  assert.equal(byFile(callSites, 'generate_text.ts').method, 'ai.generateText');
  assert.equal(byFile(callSites, 'stream_anthropic.ts').method, 'ai.streamText');
  assert.equal(byFile(callSites, 'generate_object.ts').method, 'ai.generateObject');
});

test('does not flag a same-named function from another package', async () => {
  const { callSites } = await scan(repo);
  assert.equal(callSites.find((s) => s.file === 'not_vercel.ts'), undefined);
});

test('reads provider and model from the @ai-sdk factory call', async () => {
  const { callSites } = await scan(repo);
  const g = byFile(callSites, 'generate_text.ts');
  assert.equal(g.provider, 'openai');
  assert.equal(g.model, 'gpt-4o');
  assert.equal(g.cost.inputCostUsd !== null, true); // priced

  const a = byFile(callSites, 'stream_anthropic.ts');
  assert.equal(a.provider, 'anthropic');
  assert.equal(a.model, 'claude-3-5-sonnet-20241022');
  assert.equal(a.tokens.approximate, true); // cl100k proxy
});

test('resolves system + messages, and a bare prompt string', async () => {
  const { callSites } = await scan(repo);
  const g = byFile(callSites, 'generate_text.ts');
  assert.equal(g.prompt.status, 'resolved');
  assert.equal(systemText(g), 'You are a careful reviewer of pull requests at Acme.');
  const roles = g.prompt.parts.map((p) => p.role).sort();
  assert.deepEqual(roles, ['system', 'user']);

  const a = byFile(callSites, 'stream_anthropic.ts');
  assert.equal(a.prompt.status, 'resolved');
  assert.match(a.prompt.parts[0].value.text, /Summarize the incident timeline/);
});

test('a non-OpenAI/Anthropic @ai-sdk provider is reported as other, unpriced', async () => {
  const { callSites } = await scan(repo);
  const g = byFile(callSites, 'google_other.ts');
  assert.equal(g.provider, 'other');
  assert.equal(g.model, 'gemini-1.5-pro');
  assert.equal(g.cost.inputCostUsd, null);
  assert.equal(g.tokens.approximate, true);
});

test('resolves a createOpenAI() custom instance and a `const model = openai(...)` variable', async () => {
  const { callSites } = await scan(repo);
  const c = byFile(callSites, 'custom_instance.ts');
  assert.equal(c.provider, 'openai');
  assert.equal(c.model, 'gpt-4o');

  const v = byFile(callSites, 'variable_model.ts');
  assert.equal(v.provider, 'openai');
  assert.equal(v.model, 'gpt-4o');
});
