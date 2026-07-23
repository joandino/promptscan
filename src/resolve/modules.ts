import fs from 'node:fs';
import path from 'node:path';
import type { Tree } from 'web-tree-sitter';
import { langForExtension, type LangId } from '../parse/lang.js';
import type { SymbolTable } from './symbols.js';

/** A name imported from another module: which module, and its exported name. */
export interface ImportBinding {
  module: string;
  name: string;
}

/** Import bindings extracted from one module, for cross-module resolution. */
export interface ModuleImportMaps {
  /** Local name → binding for `from mod import name [as alias]` / `import { name } from 'mod'`. */
  named: Map<string, ImportBinding>;
  /** Local alias → module spec for `import mod [as alias]` / `import * as mod from '...'`. */
  modules: Map<string, string>;
}

export function emptyImportMaps(): ModuleImportMaps {
  return { named: new Map(), modules: new Map() };
}

/** A parsed module's resolution surface: its constants and its imports. */
export interface ModuleScope {
  absPath: string;
  sourceDir: string;
  symbols: SymbolTable;
  imports: ModuleImportMaps;
}

/** Which family of path-resolution rules to apply (Python vs TS/JS). */
export type ModuleFamily = 'python' | 'ts';

export interface ModuleResolver {
  /** Resolve an import spec (from `fromDir`) to a parsed scope, or null if it isn't an in-scan file. */
  load(spec: string, fromDir: string, family: ModuleFamily): ModuleScope | null;
  /** Free every parsed module tree held open for resolution. */
  dispose(): void;
}

export interface ModuleResolverOptions {
  /** Scan root, used to bound ancestor search for Python absolute imports. */
  root: string;
  /** Read + parse a file synchronously, or null on failure. */
  parse: (absPath: string, lang: LangId) => Tree | null;
  /** Build the language-appropriate scope (symbols + imports) from a parsed tree. */
  buildScope: (absPath: string, lang: LangId, tree: Tree) => ModuleScope;
}

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_ANCESTORS = 12;

/** Candidate file paths for a Python import spec (handles relative dots + package dirs). */
function pyCandidates(spec: string, fromDir: string, root: string): string[] {
  const dots = (spec.match(/^\.+/)?.[0].length) ?? 0;
  const rest = spec.slice(dots);
  const segs = rest ? rest.split('.') : [];
  if (segs.length === 0) return [];

  const bases: string[] = [];
  if (dots > 0) {
    // Relative import: one dot = current package (fromDir), each extra dot goes up.
    let base = fromDir;
    for (let i = 1; i < dots; i++) base = path.dirname(base);
    bases.push(base);
  } else {
    // Absolute import: try the file's dir, then each ancestor up to the scan root.
    let base = fromDir;
    bases.push(base);
    for (let i = 0; i < MAX_ANCESTORS && base !== root; i++) {
      const parent = path.dirname(base);
      if (parent === base) break;
      base = parent;
      bases.push(base);
    }
  }

  const out: string[] = [];
  for (const base of bases) {
    const p = path.join(base, ...segs);
    out.push(p + '.py', path.join(p, '__init__.py'));
  }
  return out;
}

/** Candidate file paths for a relative TS/JS import spec. Bare specs are external → none. */
function tsCandidates(spec: string, fromDir: string): string[] {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return [];
  const base = path.resolve(fromDir, spec);
  const out = [base]; // spec that already carries an extension
  for (const e of TS_EXTS) out.push(base + e);
  for (const e of TS_EXTS) out.push(path.join(base, 'index' + e));
  return out;
}

/**
 * Resolve `from x import NAME` (and module-attribute) across files within the
 * scan. Parses sibling modules lazily, caches their scopes, and keeps their
 * trees alive until dispose(). Only files that exist on disk resolve; anything
 * external (a package under node_modules / site-packages) returns null so the
 * caller reports it honestly as unresolved rather than guessing.
 */
export function createModuleResolver(opts: ModuleResolverOptions): ModuleResolver {
  const cache = new Map<string, ModuleScope | null>();
  const trees: Tree[] = [];

  return {
    load(spec, fromDir, family) {
      const candidates =
        family === 'python' ? pyCandidates(spec, fromDir, opts.root) : tsCandidates(spec, fromDir);

      for (const cand of candidates) {
        const abs = path.resolve(cand);
        if (cache.has(abs)) {
          const cached = cache.get(abs);
          if (cached) return cached;
          continue;
        }
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;

        const lang = langForExtension(path.extname(abs));
        if (!lang) continue;
        const tree = opts.parse(abs, lang);
        if (!tree) {
          cache.set(abs, null);
          continue;
        }
        const scope = opts.buildScope(abs, lang, tree);
        trees.push(tree);
        cache.set(abs, scope);
        return scope;
      }
      return null;
    },

    dispose() {
      for (const t of trees) t.delete();
      trees.length = 0;
      cache.clear();
    },
  };
}
