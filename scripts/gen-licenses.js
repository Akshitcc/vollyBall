#!/usr/bin/env node
/**
 * Generates src/generated/licenses.json (About VolleyLive > Open-source licenses).
 *
 * 1.3.8 (QA V137-7): walks the app's TRANSITIVE production dependency tree offline from node_modules
 * (dependencies + optionalDependencies; never devDependencies or peerDependencies), plus (1.3.9, V138-5)
 * every installed package that ships native code (autolinking links it however it was installed), resolving
 * each name the way Node does (nearest node_modules up the tree), deduplicated by name@version. For each
 * package it records the declared licence and the full text of its LICENSE / LICENCE / COPYING / NOTICE
 * files when the package ships them. Identical texts are stored once (`texts`, referenced by index).
 *
 * Nothing is hand-written and nothing is fetched from the network: metro.config.js calls generate()
 * whenever Metro starts (which includes the Gradle release bundle), or run it by hand: `npm run licenses`.
 * Not covered: native Android/iOS libraries pulled in by Gradle/CocoaPods (e.g. AndroidX) – see KNOWN-GAPS.
 */
const fs = require('fs');
const path = require('path');

const MAX_TEXT = 40000; // per file; a few packages ship huge third-party bundles of notices
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?(\.(md|txt|markdown|rst))?$/i;

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' OR ') || 'UNKNOWN';
  return 'UNKNOWN';
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Node-style resolution of `name` required from package directory `fromDir`, stopping at `root`. */
function resolvePkgDir(name, fromDir, root) {
  let dir = fromDir;
  for (;;) {
    const cand = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    if (path.resolve(dir) === path.resolve(root)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    // skip ".../node_modules" and "@scope" levels when walking up
    dir = parent;
  }
}

function licenseTexts(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort((a, b) => (/notice/i.test(a) ? 1 : 0) - (/notice/i.test(b) ? 1 : 0) || a.localeCompare(b));
  } catch {
    return '';
  }
  const parts = [];
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(dir, f));
      if (!st.isFile()) continue;
      let t = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n').trim();
      if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT) + '\n[… truncated – see the package for the full file]';
      if (t) parts.push(files.length > 1 ? `── ${f} ──\n${t}` : t);
    } catch {
      /* unreadable file: skip */
    }
  }
  return parts.join('\n\n');
}

function repoOf(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url;
  return repo ? String(repo).replace(/^git\+/, '').replace(/\.git$/, '') : null;
}

/** Ships native code that autolinking picks up: an Android library, an iOS podspec or an Expo module. */
function shipsNativeCode(dir) {
  if (fs.existsSync(path.join(dir, 'expo-module.config.json'))) return true;
  if (fs.existsSync(path.join(dir, 'android', 'build.gradle')) || fs.existsSync(path.join(dir, 'android', 'build.gradle.kts'))) return true;
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.podspec'));
  } catch {
    return false;
  }
}

/** Top-level installed packages (node_modules/x and node_modules/@scope/x) that ship native code. */
function nativePackageDirs(root) {
  const nm = path.join(root, 'node_modules');
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(nm);
  } catch {
    return out;
  }
  for (const n of names.sort()) {
    if (n.startsWith('.')) continue;
    const dirs = n.startsWith('@') ? (() => { try { return fs.readdirSync(path.join(nm, n)).sort().map((x) => path.join(nm, n, x)); } catch { return []; } })() : [path.join(nm, n)];
    for (const d of dirs) if (fs.existsSync(path.join(d, 'package.json')) && shipsNativeCode(d)) out.push(d);
  }
  return out;
}

function collect(root = path.resolve(__dirname, '..')) {
  const app = readJson(path.join(root, 'package.json')) || {};
  const seenDirs = new Set();
  const byKey = new Map();
  const queue = [];
  const enqueue = (deps, fromDir, optional) => {
    for (const name of Object.keys(deps || {})) {
      const dir = resolvePkgDir(name, fromDir, root);
      if (!dir) {
        if (!optional && fromDir === root) byKey.set(`${name}@?`, { name, version: String(deps[name]), license: 'UNKNOWN', repository: null, text: '' });
        continue;
      }
      const real = fs.realpathSync(dir);
      if (seenDirs.has(real)) continue;
      seenDirs.add(real);
      queue.push(dir);
    }
  };
  enqueue(app.dependencies, root, false);
  enqueue(app.optionalDependencies, root, true);
  // 1.3.9 (QA V138-5): every installed package that ships native code is linked into the app by
  // autolinking wherever it came from – e.g. react-native-gesture-handler, a peer dependency of
  // expo-router, whose libgesturehandler.so is in the APK – so all of them are listed (with their
  // dependencies), not only those reached through `dependencies`.
  for (const dir of nativePackageDirs(root)) {
    const real = fs.realpathSync(dir);
    if (seenDirs.has(real)) continue;
    seenDirs.add(real);
    queue.push(dir);
  }
  while (queue.length) {
    const dir = queue.shift();
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || !pkg.name) continue;
    const key = `${pkg.name}@${pkg.version || ''}`;
    if (!byKey.has(key)) byKey.set(key, { name: pkg.name, version: pkg.version || '', license: licenseOf(pkg), repository: repoOf(pkg), homepage: typeof pkg.homepage === 'string' ? pkg.homepage : null, text: licenseTexts(dir) });
    enqueue(pkg.dependencies, dir, false);
    enqueue(pkg.optionalDependencies, dir, true);
    // peerDependencies are not followed: a production peer is the app's own dependency (or another
    // package's), while dev-only peers (jest, typescript, @types/*) would leak test tooling into the list.
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** { generatedFrom, packages: [{ name, version, license, repository, homepage, text: index|null }], texts: [] } */
function build(root) {
  const list = collect(root);
  const texts = [];
  const index = new Map();
  const packages = list.map(({ text, ...p }) => {
    let ti = null;
    if (text) {
      if (!index.has(text)) {
        index.set(text, texts.length);
        texts.push(text);
      }
      ti = index.get(text);
    }
    return { ...p, text: ti };
  });
  return { generatedFrom: 'node_modules (production dependency tree)', packages, texts };
}

function generate(root = path.resolve(__dirname, '..')) {
  const data = build(root);
  const out = path.join(root, 'src', 'generated', 'licenses.json');
  const body = JSON.stringify(data) + '\n';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== body) fs.writeFileSync(out, body);
  return data;
}

module.exports = { collect, build, generate, licenseOf, licenseTexts, resolvePkgDir, nativePackageDirs, shipsNativeCode };
if (require.main === module) {
  const d = generate();
  const missing = d.packages.filter((p) => p.text === null).length;
  console.log(`licenses.json: ${d.packages.length} packages, ${d.texts.length} distinct licence texts, ${missing} without a licence file`);
}
