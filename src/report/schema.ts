/**
 * Version of the `--format json` report shape (the `ScanReport` contract),
 * independent of the tool's package version. Additive, backward-compatible
 * changes keep this the same; a breaking change (removing/renaming a field or
 * changing its type) bumps it. The published JSON Schema pins this value.
 */
export const SCHEMA_VERSION = '1.0';
