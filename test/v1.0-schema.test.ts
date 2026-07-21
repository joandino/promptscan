import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { scan } from '../src/index.ts';
import { SCHEMA_VERSION } from '../src/report/schema.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const schema = JSON.parse(readFileSync(path.join(here, '..', 'schema', 'scanreport.schema.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

/** JSON round-trip, mirroring what `--format json` writes. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test('schema pins the current schemaVersion', () => {
  assert.equal(schema.properties.meta.properties.schemaVersion.const, SCHEMA_VERSION);
});

test('a comprehensive scan validates against the published schema', async () => {
  // Scanning all fixtures exercises every branch: all resolution statuses,
  // duplicates (exact + near), dead prompts, context bloat, TS/LangChain,
  // unpriced models, partial parses.
  const report = await scan(fixtures);
  const ok = validate(asJson(report));
  assert.ok(ok, `schema validation failed: ${JSON.stringify(validate.errors?.slice(0, 5), null, 2)}`);
  assert.equal(report.meta.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.projection, null);
});

test('a scan with a volume projection validates (non-null projection branch)', async () => {
  const report = await scan(path.join(fixtures, 'cost-repo'), { volume: { default: 100 } });
  assert.ok(report.projection, 'expected a projection');
  const ok = validate(asJson(report));
  assert.ok(ok, `schema validation failed: ${JSON.stringify(validate.errors?.slice(0, 5), null, 2)}`);
});

test('the schema rejects an unknown field (drift guard is strict)', async () => {
  const report = asJson(await scan(path.join(fixtures, 'dup-repo'))) as Record<string, unknown>;
  (report as { unexpected?: number }).unexpected = 1;
  assert.equal(validate(report), false);
});
