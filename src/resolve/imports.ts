import type { Tree, Language } from 'web-tree-sitter';
import { getDetectionQueries } from '../parse/queries.js';
import { emptyImportMaps, type ModuleImportMaps } from './modules.js';

/**
 * Extract cross-module import bindings from a parsed Python module:
 *   - `from prompts import SYSTEM_PROMPT [as SP]`  → named[SP] = {prompts, SYSTEM_PROMPT}
 *   - `from .pkg.prompts import X`                  → named[X]  = {.pkg.prompts, X}
 *   - `import prompts [as p]`                       → modules[p] = prompts
 * These let the resolver follow a name into a sibling file within the scan.
 */
export function buildPyImportMap(tree: Tree, language: Language): ModuleImportMaps {
  const maps = emptyImportMaps();
  const { imports } = getDetectionQueries(language);

  for (const { node } of imports.captures(tree.rootNode)) {
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name');
      const spec = moduleNode?.text;
      if (!spec) continue;
      for (const child of node.namedChildren) {
        if (!child || child === moduleNode) continue;
        let orig: string | undefined;
        let alias: string | undefined;
        if (child.type === 'dotted_name') {
          orig = child.text;
          alias = child.text;
        } else if (child.type === 'aliased_import') {
          orig = child.childForFieldName('name')?.text;
          alias = child.childForFieldName('alias')?.text;
        }
        if (orig && alias) maps.named.set(alias, { module: spec, name: orig });
      }
    } else if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (!child) continue;
        if (child.type === 'dotted_name') {
          // `import prompts` — only single-segment names support `prompts.X` access.
          if (!child.text.includes('.')) maps.modules.set(child.text, child.text);
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name')?.text;
          const alias = child.childForFieldName('alias')?.text;
          if (name && alias) maps.modules.set(alias, name);
        }
      }
    }
  }
  return maps;
}
