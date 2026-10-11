#!/usr/bin/env node
/**
 * Launch prep: proves a production export has no demo code in it.
 *   EXPO_PUBLIC_BACKEND=api EXPO_PUBLIC_API_AUTH=otp EXPO_PUBLIC_STRIP_DEMO=1 \
 *   EXPO_PUBLIC_API_URL=https://api.example.invalid npx expo export -p web --output-dir /tmp/vl-export
 *   node scripts/check-strip.js /tmp/vl-export [https://api.example.invalid]
 * Fails (exit 1) when a demo marker is found in any .js/.hbc file, or when the expected API URL is missing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** Strings that exist only in the demo backend / demo seed / demo QA tools. */
const DEMO_MARKERS = ['volleylive-demo-db-v2', 'volleylive-demo-auth-v1', 'volleylive-demo-qa-admin-v1', 'volleylive-demo-sim-offline-v1', '+919000000001', 'seed_admin', 'demo-qa-tools', 'demo-admin-switch'];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(js|hbc|bundle)$/.test(d.name) ? [p] : [];
  });
}

function checkStrip(dir, apiUrl) {
  const list = files(dir);
  const found = [];
  let hasApi = !apiUrl;
  for (const f of list) {
    const text = fs.readFileSync(f).toString('latin1');
    for (const m of DEMO_MARKERS) if (text.includes(m)) found.push(`${path.relative(dir, f)}: ${m}`);
    if (apiUrl && text.includes(apiUrl)) hasApi = true;
  }
  return { files: list.length, found, hasApi };
}

if (require.main === module) {
  const [dir, apiUrl] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/check-strip.js <export-dir> [expected-api-url]');
    process.exit(2);
  }
  const r = checkStrip(dir, apiUrl);
  console.log(`checked ${r.files} bundle file(s)`);
  if (!r.files) process.exit(1);
  if (r.found.length) console.error('demo code found:\n  ' + r.found.join('\n  '));
  if (!r.hasApi) console.error(`expected API URL not found in the bundle: ${apiUrl}`);
  if (r.found.length || !r.hasApi) process.exit(1);
  console.log('OK: no demo markers' + (apiUrl ? `, API URL present` : ''));
}

module.exports = { DEMO_MARKERS, checkStrip };
