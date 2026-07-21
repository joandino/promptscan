import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Resolves to the package root in both dev (src/) and build (dist/) layouts.
const pkg = require('../package.json') as { version: string };

export const VERSION: string = pkg.version;
