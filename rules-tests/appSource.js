/**
 * 1.4.4 (QA V143-5): loads the app's own TypeScript modules (src/core, src/services/backend/firebaseMatchDoc.ts)
 * into the rules tests, so match documents are built exactly as the app builds them. A tiny CommonJS loader:
 * every relative import is transpiled from ../src with the app's TypeScript (no Babel/Jest transform needed);
 * bare imports use Node's require. Only pure modules (no React Native / Firebase SDK imports) can be loaded.
 */
const fs = require('fs');
const path = require('path');
const ts = require('../node_modules/typescript');

const cache = new Map();
function resolve(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const f of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  throw new Error(`appSource: cannot resolve ${spec} from ${from}`);
}
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.React },
  }).outputText;
  const m = { exports: {} };
  cache.set(file, m);
  const req = (spec) => (spec.startsWith('.') ? load(resolve(file, spec)) : require(spec));
  new Function('require', 'module', 'exports', '__filename', '__dirname', js)(req, m, m.exports, file, path.dirname(file));
  return m.exports;
}
/** loadApp('src/core/buildMatch.ts') – path relative to the app root. */
module.exports = (rel) => load(path.join(__dirname, '..', rel));
