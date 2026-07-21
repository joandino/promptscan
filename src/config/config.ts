import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { VolumeConfig } from '../pricing/cost.js';

/**
 * Project configuration. Every field is optional — the built-in defaults apply
 * to anything unset, so zero config still works. CLI flags override these.
 */
export interface PromptScanConfig {
  gitignore?: boolean;
  duplicates?: { similarity?: number; minWords?: number };
  bloat?: {
    largeTokens?: number;
    manyMessages?: number;
    boilerplateMinSites?: number;
    boilerplateMinWords?: number;
  };
  volume?: VolumeConfig;
}

export interface LoadedConfig {
  config: PromptScanConfig;
  /** Path the config was loaded from, or null when none was found. */
  path: string | null;
}

const CANDIDATES = [
  'promptscan.config.json',
  'promptscan.config.yaml',
  'promptscan.config.yml',
  '.promptscanrc',
  '.promptscanrc.json',
  '.promptscanrc.yaml',
  '.promptscanrc.yml',
];

function fail(msg: string): never {
  throw new Error(`config: ${msg}`);
}

function num(value: unknown, label: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a number`);
  const v = value as number;
  if (opts.min !== undefined && v < opts.min) fail(`${label} must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) fail(`${label} must be <= ${opts.max}`);
  return v;
}

function validate(data: unknown, source: string): PromptScanConfig {
  if (data === null || data === undefined) return {};
  if (typeof data !== 'object' || Array.isArray(data)) fail(`${source} must be a mapping`);
  const obj = data as Record<string, unknown>;
  const cfg: PromptScanConfig = {};

  if (obj.gitignore !== undefined) {
    if (typeof obj.gitignore !== 'boolean') fail('gitignore must be a boolean');
    cfg.gitignore = obj.gitignore;
  }

  if (obj.duplicates !== undefined) {
    const d = obj.duplicates as Record<string, unknown>;
    if (typeof d !== 'object' || d === null) fail('duplicates must be a mapping');
    cfg.duplicates = {};
    if (d.similarity !== undefined) cfg.duplicates.similarity = num(d.similarity, 'duplicates.similarity', { min: 0, max: 1 });
    if (d.minWords !== undefined) cfg.duplicates.minWords = num(d.minWords, 'duplicates.minWords', { min: 0 });
  }

  if (obj.bloat !== undefined) {
    const b = obj.bloat as Record<string, unknown>;
    if (typeof b !== 'object' || b === null) fail('bloat must be a mapping');
    cfg.bloat = {};
    if (b.largeTokens !== undefined) cfg.bloat.largeTokens = num(b.largeTokens, 'bloat.largeTokens', { min: 0 });
    if (b.manyMessages !== undefined) cfg.bloat.manyMessages = num(b.manyMessages, 'bloat.manyMessages', { min: 0 });
    if (b.boilerplateMinSites !== undefined) cfg.bloat.boilerplateMinSites = num(b.boilerplateMinSites, 'bloat.boilerplateMinSites', { min: 2 });
    if (b.boilerplateMinWords !== undefined) cfg.bloat.boilerplateMinWords = num(b.boilerplateMinWords, 'bloat.boilerplateMinWords', { min: 0 });
  }

  if (obj.volume !== undefined) {
    const v = obj.volume as Record<string, unknown>;
    if (typeof v !== 'object' || v === null) fail('volume must be a mapping');
    const volume: VolumeConfig = {};
    if (v.default !== undefined) volume.default = num(v.default, 'volume.default', { min: 0 });
    if (v.sites !== undefined) {
      if (typeof v.sites !== 'object' || v.sites === null) fail('volume.sites must be a mapping');
      const sites: Record<string, number> = {};
      for (const [k, val] of Object.entries(v.sites as Record<string, unknown>)) {
        sites[k] = num(val, `volume.sites["${k}"]`, { min: 0 });
      }
      volume.sites = sites;
    }
    cfg.volume = volume;
  }

  return cfg;
}

function read(filePath: string): PromptScanConfig {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    fail(`could not read ${filePath}`);
  }
  let data: unknown;
  try {
    data = parseYaml(raw); // YAML is a JSON superset — handles both
  } catch (err) {
    fail(`${filePath} is not valid YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return validate(data, filePath);
}

/**
 * Load configuration. With an explicit path, that file is required. Otherwise
 * search the working directory and its ancestors for a known config filename,
 * returning the first match (or an empty config).
 */
export function loadConfig(explicitPath?: string, cwd: string = process.cwd()): LoadedConfig {
  if (explicitPath) {
    if (!existsSync(explicitPath)) fail(`config file not found: ${explicitPath}`);
    return { config: read(explicitPath), path: explicitPath };
  }

  let dir = path.resolve(cwd);
  for (;;) {
    for (const name of CANDIDATES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return { config: read(candidate), path: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { config: {}, path: null };
}
