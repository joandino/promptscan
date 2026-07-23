import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const pyRepo = path.join(here, 'fixtures', 'crossmodule-repo');
const tsRepo = path.join(here, 'fixtures', 'crossmodule-ts-repo');

function byFile(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

function systemText(site: CallSite): string | undefined {
  return site.prompt.parts.find((p) => p.role === 'system')?.value.text;
}

test('Python: resolves `from prompts import SYSTEM_PROMPT` across files', async () => {
  const { callSites } = await scan(pyRepo);
  const a = byFile(callSites, 'agent.py');
  assert.equal(a.prompt.status, 'resolved');
  assert.equal(systemText(a), 'You are a meticulous senior support engineer at Acme Co.');
});

test('Python: resolves `import prompts; prompts.SYSTEM_PROMPT` (module attribute)', async () => {
  const { callSites } = await scan(pyRepo);
  const a = byFile(callSites, 'agent_module.py');
  assert.equal(a.prompt.status, 'resolved');
  assert.equal(systemText(a), 'You are a meticulous senior support engineer at Acme Co.');
});

test('Python: follows a two-hop re-export (agent → prompts → base)', async () => {
  const { callSites } = await scan(pyRepo);
  const a = byFile(callSites, 'agent_chain.py');
  assert.equal(a.prompt.status, 'resolved');
  assert.equal(systemText(a), 'You are the base assistant shared across every Acme agent.');
});

test('Python: an import from a package outside the scan stays unresolved with a reason', async () => {
  const { callSites } = await scan(pyRepo);
  const a = byFile(callSites, 'agent_external.py');
  assert.equal(a.prompt.status, 'unresolved');
  assert.match(a.prompt.reason ?? '', /not found in scan|external/);
});

test('Python: cross-module resolution lifts the resolved-prompt tally', async () => {
  const { stats } = await scan(pyRepo);
  assert.equal(stats.callSites, 4);
  assert.equal(stats.promptsResolved, 3); // agent, agent_module, agent_chain
  assert.equal(stats.promptsUnresolved, 1); // agent_external
});

test('TS: resolves `import { SYSTEM_PROMPT } from "./prompts"`', async () => {
  const { callSites } = await scan(tsRepo);
  const a = byFile(callSites, 'agent.ts');
  assert.equal(a.prompt.status, 'resolved');
  assert.equal(systemText(a), 'You are a careful reviewer of pull requests at Acme.');
});

test('TS: resolves `import * as prompts` namespace member access', async () => {
  const { callSites } = await scan(tsRepo);
  const a = byFile(callSites, 'agent_ns.ts');
  assert.equal(a.prompt.status, 'resolved');
  assert.equal(systemText(a), 'You are a careful reviewer of pull requests at Acme.');
});

test('TS: a relative import to a missing file stays unresolved with a reason', async () => {
  const { callSites } = await scan(tsRepo);
  const a = byFile(callSites, 'agent_missing.ts');
  assert.equal(a.prompt.status, 'unresolved');
  assert.match(a.prompt.reason ?? '', /not found in scan|external/);
});
