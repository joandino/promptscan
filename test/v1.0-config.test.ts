import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const configDir = path.join(here, 'fixtures', 'config');

test('loads a YAML config from an explicit path', () => {
  const { config, path: p } = loadConfig(path.join(configDir, 'promptscan.config.yaml'));
  assert.equal(config.gitignore, false);
  assert.equal(config.duplicates?.similarity, 0.9);
  assert.equal(config.duplicates?.minWords, 4);
  assert.equal(config.bloat?.largeTokens, 1500);
  assert.equal(config.bloat?.boilerplateMinSites, 5);
  assert.equal(config.volume?.default, 2000);
  assert.equal(config.volume?.sites?.['src/agent.py:10'], 90000);
  assert.ok(p?.endsWith('promptscan.config.yaml'));
});

test('loads a JSON config (YAML is a JSON superset)', () => {
  const { config } = loadConfig(path.join(configDir, 'promptscan.config.json'));
  assert.equal(config.duplicates?.similarity, 0.7);
  assert.equal(config.bloat?.manyMessages, 10);
});

test('auto-discovers a config from an ancestor directory', () => {
  const { config, path: p } = loadConfig(undefined, path.join(configDir, 'nested', 'deep'));
  assert.ok(p, 'should find a config walking up');
  // The .json is earlier in the candidate list than .yaml, so it wins here.
  assert.ok(config.duplicates?.similarity === 0.7 || config.duplicates?.similarity === 0.9);
});

test('returns an empty config when none is found', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'promptscan-cfg-'));
  try {
    const { config, path: p } = loadConfig(undefined, empty);
    assert.deepEqual(config, {});
    assert.equal(p, null);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('rejects a missing explicit config file', () => {
  assert.throws(() => loadConfig(path.join(configDir, 'nope.yaml')), /not found/);
});

test('validates value ranges and types', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'promptscan-cfg-'));
  const bad = path.join(dir, 'bad.yaml');
  try {
    writeFileSync(bad, 'duplicates:\n  similarity: 5\n');
    assert.throws(() => loadConfig(bad), /similarity must be <= 1/);

    writeFileSync(bad, 'gitignore: "yes"\n');
    assert.throws(() => loadConfig(bad), /gitignore must be a boolean/);

    writeFileSync(bad, '- 1\n- 2\n');
    assert.throws(() => loadConfig(bad), /must be a mapping/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
