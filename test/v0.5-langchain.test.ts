import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'langchain-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

test('detects LangChain invoke() call sites across Python and TS/JS', async () => {
  const { callSites, stats } = await scan(repo);
  assert.equal(stats.callSites, 6);
  assert.equal(callSites.filter((s) => s.provider === 'openai').length, 4);
  assert.equal(callSites.filter((s) => s.provider === 'anthropic').length, 2);
  assert.ok(callSites.every((s) => s.method.startsWith('langchain.')));
});

test('does not flag generic .invoke()/.stream() on unbound objects', async () => {
  const { callSites } = await scan(repo);
  assert.equal(callSites.find((s) => s.file === 'not_langchain.py'), undefined);
  assert.equal(callSites.find((s) => s.file === 'not_langchain.ts'), undefined);
});

test('takes the model from the LangChain constructor', async () => {
  const { callSites } = await scan(repo);
  assert.equal(byFile(callSites, 'lc_openai.py').model, 'gpt-4o');
  assert.equal(byFile(callSites, 'lc_openai.ts').model, 'gpt-4o');
  assert.equal(byFile(callSites, 'lc_string.py').model, 'gpt-4o-mini');
  assert.equal(byFile(callSites, 'lc_string.js').model, 'gpt-4o-mini');
});

test('propagates the model binding through a pipe chain', async () => {
  const { callSites } = await scan(repo);
  // `chain = prompt | model` (py) / `prompt.pipe(model)` (ts) → chain.invoke uses the model.
  assert.equal(byFile(callSites, 'lc_anthropic_chain.py').model, 'claude-sonnet-5');
  assert.equal(byFile(callSites, 'lc_anthropic_chain.py').provider, 'anthropic');
  assert.equal(byFile(callSites, 'lc_anthropic_chain.ts').model, 'claude-sonnet-5');
});

test('resolves invoke() message lists and plain strings', async () => {
  const { callSites } = await scan(repo);
  const py = byFile(callSites, 'lc_openai.py');
  assert.equal(py.prompt.status, 'resolved');
  const roles = py.prompt.parts.map((p) => p.role).sort();
  assert.deepEqual(roles, ['system', 'user']);
  assert.equal(py.prompt.parts.find((p) => p.role === 'system')?.value.text, 'You are a meticulous assistant.');

  const str = byFile(callSites, 'lc_string.py');
  assert.equal(str.prompt.status, 'resolved');
  assert.match(str.prompt.parts[0].value.text, /Summarize the meeting notes/);
});

test('template-based chain input is honestly unresolved', async () => {
  const { callSites } = await scan(repo);
  const chain = byFile(callSites, 'lc_anthropic_chain.py');
  assert.equal(chain.prompt.status, 'unresolved');
  assert.match(chain.prompt.reason ?? '', /template/);
});
