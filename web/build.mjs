import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const OUT = 'docs';
mkdirSync(OUT, { recursive: true });

// web-tree-sitter's Emscripten glue references Node built-ins inside a
// `ENVIRONMENT_IS_NODE` branch that never runs in a browser. Stub those bare
// specifiers with empty modules so the bundle resolves.
const stubNodeOnly = {
  name: 'stub-node-only',
  setup(build) {
    build.onResolve({ filter: /^(fs\/promises|module|fs|os|worker_threads|crypto)$/ }, (args) => ({
      path: args.path,
      namespace: 'node-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
      contents:
        'const nope = () => { throw new Error("node built-in unavailable in browser"); };\n' +
        'export const readFile = nope;\n' +
        'export const createRequire = nope;\n' +
        'export default {};\n',
      loader: 'js',
    }));
  },
};

// Bundle the playground. node:fs → a throwing browser stub (no filesystem);
// node:path → path-browserify. Everything else is browser-native
// (web-tree-sitter WASM, js-tiktoken).
await esbuild.build({
  entryPoints: ['web/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  outfile: path.join(OUT, 'app.js'),
  alias: {
    'node:fs': path.resolve('web/shims/node-fs.ts'),
    'node:path': 'path-browserify',
  },
  plugins: [stubNodeOnly],
  logLevel: 'info',
});

// Copy the WASM runtime + grammars next to the page (loaded by relative URL).
const wtsDir = path.dirname(require.resolve('web-tree-sitter'));
const runtime = path.join(wtsDir, 'tree-sitter.wasm');
if (!existsSync(runtime)) throw new Error(`missing web-tree-sitter runtime: ${runtime}`);
cpSync(runtime, path.join(OUT, 'tree-sitter.wasm'));

for (const g of ['python', 'typescript', 'tsx']) {
  const src = require.resolve(`tree-sitter-wasms/out/tree-sitter-${g}.wasm`);
  cpSync(src, path.join(OUT, `tree-sitter-${g}.wasm`));
}

cpSync('web/index.html', path.join(OUT, 'index.html'));
writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files verbatim (no Jekyll)

console.log('Playground built → docs/');
