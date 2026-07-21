import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const detectRepo = path.join(here, 'fixtures', 'detect-repo');

function byFile(sites: CallSite[], file: string): CallSite | undefined {
  return sites.find((s) => s.file === file);
}

test('detects the expected call sites and provider breakdown', async () => {
  const { callSites, stats } = await scan(detectRepo);
  assert.equal(stats.callSites, 7);
  assert.equal(callSites.filter((s) => s.provider === 'openai').length, 4);
  assert.equal(callSites.filter((s) => s.provider === 'anthropic').length, 3);
});

test('rejects short chains with no import and no binding (no false positives)', async () => {
  const { callSites } = await scan(detectRepo);
  assert.equal(byFile(callSites, 'false_positive.py'), undefined);
});

test('binds client variables through direct, aliased, and from-imports', async () => {
  const { callSites } = await scan(detectRepo);
  assert.equal(byFile(callSites, 'openai_basic.py')?.basis, 'binding'); // openai.OpenAI()
  assert.equal(byFile(callSites, 'aliased.py')?.basis, 'binding'); //     oai.OpenAI()
  assert.equal(byFile(callSites, 'from_import.py')?.basis, 'binding'); //  AsyncAnthropic()
});

test('self-identifying chains need no import; short chains fall back to import', async () => {
  const { callSites } = await scan(detectRepo);
  const shape = byFile(callSites, 'shape_only.py');
  assert.equal(shape?.confidence, 'high');
  assert.equal(shape?.basis, 'shape');

  const importOnly = byFile(callSites, 'import_only.py');
  assert.equal(importOnly?.confidence, 'medium');
  assert.equal(importOnly?.basis, 'import');
});

test('resolves literal models and reports dynamic ones as unresolved', async () => {
  const { callSites, stats } = await scan(detectRepo);
  assert.equal(stats.modelsResolved, 5);

  assert.equal(byFile(callSites, 'openai_basic.py')?.model, 'gpt-4o');
  assert.equal(byFile(callSites, 'anthropic_basic.py')?.model, 'claude-sonnet-5');

  const fromImport = byFile(callSites, 'from_import.py');
  assert.equal(fromImport?.modelResolved, false);
  assert.equal(fromImport?.modelHint, 'MODEL');

  const dynamic = byFile(callSites, 'dynamic_model.py');
  assert.equal(dynamic?.modelResolved, false);
  assert.equal(dynamic?.modelHint, 'f"gpt-{ver}"');
});

test('records precise provider and method', async () => {
  const { callSites } = await scan(detectRepo);
  assert.equal(byFile(callSites, 'aliased.py')?.method, 'responses.create');
  assert.equal(byFile(callSites, 'anthropic_basic.py')?.method, 'messages.create');
  assert.equal(byFile(callSites, 'openai_basic.py')?.method, 'chat.completions.create');
});
