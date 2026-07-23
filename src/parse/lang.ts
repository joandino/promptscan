/**
 * Pure language identity helpers — no Node built-ins, so this module is safe to
 * bundle for the browser (the playground) as well as Node. `parser.ts` re-exports
 * these for existing callers.
 */

/** Grammars PromptScan can parse. */
export type LangId = 'python' | 'typescript' | 'tsx';

/** Map a file extension to the grammar that parses it, or null if unsupported. */
export function langForExtension(ext: string): LangId | null {
  switch (ext.toLowerCase()) {
    case '.py':
      return 'python';
    case '.ts':
    case '.mts':
    case '.cts':
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'typescript';
    case '.tsx':
    case '.jsx':
      return 'tsx';
    default:
      return null;
  }
}
