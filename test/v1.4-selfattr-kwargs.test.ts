import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'selfattr-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

const systemText = (s: CallSite) => s.prompt.parts.find((p) => p.role === 'system')?.value.text;

test('resolves a prompt held in self.<attr> set in __init__', async () => {
  const { callSites } = await scan(repo);
  const a = byFile(callSites, 'agent.py');
  // The system message resolves through self.system → SUPPORT_PROMPT; the user
  // message is a runtime parameter, so the prompt is honestly partial overall.
  assert.equal(a.prompt.status, 'partial');
  assert.equal(systemText(a), 'You are a meticulous senior support engineer at Acme Co.');
  assert.ok(a.tokens.inputTokens > 0, 'the resolved system prompt is counted');
});

test('resolves the model from self.model', async () => {
  const { callSites } = await scan(repo);
  const a = byFile(callSites, 'agent.py');
  assert.equal(a.modelResolved, true);
  assert.equal(a.model, 'gpt-4o');
  assert.equal(a.provider, 'openai');
  assert.ok(a.cost.inputCostUsd !== null, 'a resolved model should be priced');
});

test('resolves model + messages from a **kwargs dict spread', async () => {
  const { callSites } = await scan(repo);
  const k = byFile(callSites, 'kwargs_agent.py');
  assert.equal(k.model, 'gpt-4o-mini');
  assert.equal(k.modelResolved, true);
  assert.equal(k.prompt.status, 'resolved');
  assert.equal(systemText(k), 'You classify incoming tickets by urgency.');
  assert.ok(k.tokens.inputTokens > 0);
});

test('a self.<attr> assigned more than once stays honestly unresolved', async () => {
  const { callSites } = await scan(repo);
  const r = byFile(callSites, 'reassigned.py');
  assert.equal(r.prompt.status, 'unresolved');
  assert.match(r.prompt.reason ?? '', /assigned more than once|not a stable value/);
});
