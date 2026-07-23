import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initParser, createParser, getLanguage } from '../src/parse/parser.ts';
import { scanSnippet } from '../web/core.ts';

// These exercise the exact function the browser playground calls — the analysis
// runs identically in Node and the browser (web-tree-sitter is WASM in both).

test('scanSnippet: detects an OpenAI call and resolves the prompt (python)', async () => {
  await initParser();
  const parser = createParser('python');
  const language = getLanguage('python');
  const code = [
    'import openai',
    'client = openai.OpenAI()',
    'resp = client.chat.completions.create(',
    '    model="gpt-4o",',
    '    messages=[',
    '        {"role": "system", "content": "You are a meticulous senior support engineer."},',
    '        {"role": "user", "content": "Summarize this ticket for the on-call rotation."},',
    '    ],',
    ')',
  ].join('\n');

  const r = scanSnippet(code, 'python', parser, language);
  assert.equal(r.stats.callSites, 1);
  assert.equal(r.callSites[0].provider, 'openai');
  assert.equal(r.callSites[0].model, 'gpt-4o');
  assert.equal(r.callSites[0].prompt.status, 'resolved');
  assert.ok(r.stats.inputTokens > 0, 'tokens counted');
  assert.ok(r.stats.inputCostUsd > 0, 'cost priced');
  parser.delete();
});

test('scanSnippet: finds an exact duplicate across two TS calls', async () => {
  await initParser();
  const parser = createParser('typescript');
  const language = getLanguage('typescript');
  const code = [
    'import OpenAI from "openai";',
    'const client = new OpenAI();',
    'const a = client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: "Shared system prompt reused across several agents." }] });',
    'const b = client.chat.completions.create({ model: "gpt-4o", messages: [{ role: "system", content: "Shared system prompt reused across several agents." }] });',
  ].join('\n');

  const r = scanSnippet(code, 'typescript', parser, language);
  assert.equal(r.stats.callSites, 2);
  assert.equal(r.stats.exactDuplicateGroups, 1);
  parser.delete();
});

test('scanSnippet: detects a Vercel AI SDK call and resolves system + messages', async () => {
  await initParser();
  const parser = createParser('typescript');
  const language = getLanguage('typescript');
  const code = [
    'import { generateText } from "ai";',
    'import { openai } from "@ai-sdk/openai";',
    'const model = openai("gpt-4o");',
    'const out = generateText({ model, system: "You are a careful reviewer of pull requests.", messages: [{ role: "user", content: ticket }] });',
  ].join('\n');

  const r = scanSnippet(code, 'typescript', parser, language);
  assert.equal(r.stats.callSites, 1);
  assert.equal(r.callSites[0].provider, 'openai');
  assert.equal(r.callSites[0].model, 'gpt-4o');
  assert.equal(r.callSites[0].method, 'ai.generateText');
  assert.ok(r.stats.inputTokens > 0);
  parser.delete();
});

test('scanSnippet: a cross-file import is honestly unresolved in the browser (no fs)', async () => {
  await initParser();
  const parser = createParser('python');
  const language = getLanguage('python');
  const code = [
    'import openai',
    'from prompts import SYSTEM_PROMPT',
    'client = openai.OpenAI()',
    'resp = client.chat.completions.create(model="gpt-4o", messages=[{"role":"system","content":SYSTEM_PROMPT}])',
  ].join('\n');

  const r = scanSnippet(code, 'python', parser, language);
  assert.equal(r.stats.callSites, 1);
  assert.equal(r.callSites[0].prompt.status, 'unresolved');
  parser.delete();
});
