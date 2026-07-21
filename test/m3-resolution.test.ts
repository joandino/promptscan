import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.ts';
import type { CallSite } from '../src/report/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, 'fixtures', 'resolve-repo');

function site(sites: CallSite[], file: string): CallSite {
  const s = sites.find((x) => x.file === file);
  assert.ok(s, `expected a call site in ${file}`);
  return s;
}

/** Combined static text across all prompt parts. */
function text(s: CallSite): string {
  return s.prompt.parts.map((p) => p.value.text).join('|');
}

test('overall resolution tally', async () => {
  const { stats } = await scan(repo);
  assert.equal(stats.promptsResolved, 7);
  assert.equal(stats.promptsPartial, 1);
  assert.equal(stats.promptsUnresolved, 2);
});

test('resolves literal message contents with roles', async () => {
  const s = site((await scan(repo)).callSites, 'literal_messages.py');
  assert.equal(s.prompt.status, 'resolved');
  assert.equal(s.prompt.parts.length, 2);
  assert.equal(s.prompt.parts[0].role, 'system');
  assert.equal(s.prompt.parts[0].value.text, 'You are a helpful assistant.');
  assert.equal(s.prompt.parts[1].role, 'user');
  assert.equal(s.prompt.parts[1].value.text, 'What is 2 + 2?');
});

test('resolves a module-level constant (single assignment)', async () => {
  const s = site((await scan(repo)).callSites, 'const_prompt.py');
  assert.equal(s.prompt.status, 'resolved');
  assert.equal(s.prompt.parts[0].value.text, 'You are an expert Python reviewer.');
});

test('f-string is partial: static kept, interpolation marked dynamic', async () => {
  const s = site((await scan(repo)).callSites, 'fstring_prompt.py');
  assert.equal(s.prompt.status, 'partial');
  const val = s.prompt.parts[0].value;
  assert.equal(val.text, 'Please answer: ');
  assert.ok(val.segments.some((seg) => seg.kind === 'dynamic'));
});

test('resolves const + binary + implicit concatenation', async () => {
  const s = site((await scan(repo)).callSites, 'concat_prompt.py');
  assert.equal(s.prompt.status, 'resolved');
  assert.equal(s.prompt.parts[0].value.text, 'System: be terse.  Always.');
});

test('resolves prompts loaded from files (open().read and Path().read_text)', async () => {
  const s = site((await scan(repo)).callSites, 'file_prompt.py');
  assert.equal(s.prompt.status, 'resolved');
  const sources = s.prompt.parts.map((p) => p.value.source);
  assert.deepEqual(sources, ['file', 'file']);
  assert.match(text(s), /precise assistant/);
  assert.match(text(s), /Support Agent/);
});

test('follows a variable to its list literal', async () => {
  const s = site((await scan(repo)).callSites, 'messages_var.py');
  assert.equal(s.prompt.status, 'resolved');
  assert.equal(s.prompt.parts.length, 2);
});

test('dynamic messages list is unresolved with a reason', async () => {
  const s = site((await scan(repo)).callSites, 'dynamic_messages.py');
  assert.equal(s.prompt.status, 'unresolved');
  assert.match(s.prompt.reason ?? '', /not a static list/);
});

test('reassigned variable is not treated as a constant', async () => {
  const s = site((await scan(repo)).callSites, 'reassigned.py');
  assert.equal(s.prompt.status, 'unresolved');
  assert.match(s.prompt.reason ?? '', /reassigned/);
});

test('responses.create resolves instructions and input', async () => {
  const s = site((await scan(repo)).callSites, 'responses_input.py');
  assert.equal(s.prompt.status, 'resolved');
  const origins = s.prompt.parts.map((p) => p.origin).sort();
  assert.deepEqual(origins, ['input', 'instructions']);
});

test('anthropic system as text blocks resolves', async () => {
  const s = site((await scan(repo)).callSites, 'system_blocks.py');
  assert.equal(s.prompt.status, 'resolved');
  const systemPart = s.prompt.parts.find((p) => p.origin === 'system');
  assert.equal(systemPart?.value.text, 'You are helpful.');
});
