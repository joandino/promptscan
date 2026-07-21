import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { VolumeConfig } from './cost.js';

/**
 * Load and validate a call-volume config (YAML or JSON) from disk. Shape:
 *
 *   default: 1000
 *   sites:
 *     "src/agents/support.py:44": 50000
 *
 * Throws with a clear message on malformed input rather than silently ignoring it.
 */
export function loadVolumeConfig(path: string): VolumeConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`volume config not found: ${path}`);
  }

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new Error(`volume config is not valid YAML/JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (data === null || typeof data !== 'object') {
    throw new Error('volume config must be a mapping with "default" and/or "sites"');
  }

  const obj = data as Record<string, unknown>;
  const config: VolumeConfig = {};

  if (obj.default !== undefined) {
    if (typeof obj.default !== 'number' || obj.default < 0) {
      throw new Error('volume config "default" must be a non-negative number');
    }
    config.default = obj.default;
  }

  if (obj.sites !== undefined) {
    if (obj.sites === null || typeof obj.sites !== 'object') {
      throw new Error('volume config "sites" must be a mapping of "file:line" to counts');
    }
    const sites: Record<string, number> = {};
    for (const [key, value] of Object.entries(obj.sites as Record<string, unknown>)) {
      if (typeof value !== 'number' || value < 0) {
        throw new Error(`volume config site "${key}" must be a non-negative number`);
      }
      sites[key] = value;
    }
    config.sites = sites;
  }

  return config;
}
