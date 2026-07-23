import { Query, type Language } from 'web-tree-sitter';

/**
 * Tree-sitter queries used by call-site detection. Query construction is
 * relatively expensive, so instances are cached per Language.
 */
export interface DetectionQueries {
  /** Method calls whose callee is an attribute chain (e.g. a.b.c.create(...)). */
  attributeCalls: Query;
  /** Calls whose callee is a bare identifier (e.g. completion(...)), for litellm from-imports. */
  identifierCalls: Query;
  /** import and from-import statements. */
  imports: Query;
  /** name = <call>(...) assignments, for binding client variables to providers. */
  assignments: Query;
  /** name = <any expr> assignments, for LangChain model + pipe-chain bindings. */
  anyAssignments: Query;
}

const cache = new WeakMap<Language, DetectionQueries>();

export function getDetectionQueries(language: Language): DetectionQueries {
  const cached = cache.get(language);
  if (cached) return cached;

  const queries: DetectionQueries = {
    attributeCalls: new Query(language, '(call function: (attribute) @fn) @call'),
    identifierCalls: new Query(language, '(call function: (identifier) @fn) @call'),
    imports: new Query(language, '[(import_statement) (import_from_statement)] @imp'),
    assignments: new Query(
      language,
      '(assignment left: (identifier) @name right: (call) @rhs)',
    ),
    anyAssignments: new Query(
      language,
      '(assignment left: (identifier) @name right: (_) @rhs)',
    ),
  };

  cache.set(language, queries);
  return queries;
}
