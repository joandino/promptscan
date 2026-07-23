import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import { providerForLiteLLMModel } from '../src/detect/context.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'litellm-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

test('detects litellm completion/acompletion, both module and from-import forms', async () => {
  const { callSites, stats } = await scan(repo);
  // openai, anthropic, async, gemini, dynamic, reexport — but NOT not_litellm.py.
  assert.equal(stats.callSites, 6);
  assert.ok(callSites.every((s) => s.method.startsWith('litellm.')));
  assert.equal(byFile(callSites, 'openai_call.py').method, 'litellm.completion');
  assert.equal(byFile(callSites, 'async_call.py').method, 'litellm.acompletion');
});

test('detects a re-exported litellm proxy (the aider `from x.llm import litellm` pattern)', async () => {
  const { callSites } = await scan(repo);
  const r = byFile(callSites, 'reexport_call.py');
  assert.equal(r.method, 'litellm.completion');
  assert.equal(r.provider, 'openai');
  assert.equal(r.model, 'gpt-4o');
});

test('does not flag a completion() call without a litellm import', async () => {
  const { callSites } = await scan(repo);
  assert.equal(callSites.find((s) => s.file === 'not_litellm.py'), undefined);
});

test('infers provider and model from the litellm model= string', async () => {
  const { callSites } = await scan(repo);
  const oa = byFile(callSites, 'openai_call.py');
  assert.equal(oa.provider, 'openai');
  assert.equal(oa.model, 'gpt-4o');
  assert.equal(oa.cost.inputCostUsd !== null, true); // priced

  const an = byFile(callSites, 'anthropic_call.py');
  assert.equal(an.provider, 'anthropic');
  assert.equal(an.model, 'claude-3-5-sonnet-20241022');
  assert.equal(an.tokens.approximate, true); // cl100k proxy

  const asyncSite = byFile(callSites, 'async_call.py');
  assert.equal(asyncSite.provider, 'openai');
  assert.equal(asyncSite.model, 'gpt-4o-mini');
});

test('resolves the OpenAI-style messages prompt', async () => {
  const { callSites } = await scan(repo);
  const oa = byFile(callSites, 'openai_call.py');
  assert.equal(oa.prompt.status, 'resolved');
  const roles = oa.prompt.parts.map((p) => p.role).sort();
  assert.deepEqual(roles, ['system', 'user']);
  assert.ok(oa.tokens.inputTokens > 0);
});

test('a non-OpenAI/Anthropic litellm backend is reported as other, proxy-tokenized and unpriced', async () => {
  const { callSites } = await scan(repo);
  const g = byFile(callSites, 'gemini_call.py');
  assert.equal(g.provider, 'other');
  assert.equal(g.model, 'gemini/gemini-1.5-pro');
  assert.equal(g.modelResolved, true);
  assert.equal(g.cost.inputCostUsd, null); // unpriced, never guessed
  assert.equal(g.tokens.approximate, true);
  assert.ok(g.tokens.notes.some((n) => /litellm/.test(n)));
});

test('an unresolvable model leaves the provider undetermined (other) with a hint', async () => {
  const { callSites } = await scan(repo);
  const d = byFile(callSites, 'dynamic_model.py');
  assert.equal(d.provider, 'other');
  assert.equal(d.modelResolved, false);
  assert.match(d.modelHint ?? '', /pick_model/);
  // the prompt itself still resolves even though the model doesn't
  assert.equal(d.prompt.status, 'resolved');
});

test('providerForLiteLLMModel maps prefixes and bare names correctly', () => {
  assert.deepEqual(providerForLiteLLMModel('gpt-4o'), { provider: 'openai', model: 'gpt-4o' });
  assert.deepEqual(providerForLiteLLMModel('openai/gpt-4o'), { provider: 'openai', model: 'gpt-4o' });
  assert.deepEqual(providerForLiteLLMModel('claude-3-5-sonnet-20241022'), {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
  });
  assert.deepEqual(providerForLiteLLMModel('anthropic/claude-sonnet-4-5'), {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
  });
  // Claude hosted behind Bedrock is still Anthropic; the vendor segment is stripped.
  assert.deepEqual(providerForLiteLLMModel('bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0'), {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20240620-v1:0',
  });
  assert.equal(providerForLiteLLMModel('gemini/gemini-1.5-pro').provider, 'other');
  assert.equal(providerForLiteLLMModel('groq/llama-3.1-70b').provider, 'other');
});
