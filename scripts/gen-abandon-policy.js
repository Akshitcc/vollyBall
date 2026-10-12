#!/usr/bin/env node
/**
 * 1.4.5 (QA V144-1): copies ABANDON_POLICY from src/core/abandonPolicy.ts into firestore.rules abandonPolicy().
 *   node scripts/gen-abandon-policy.js          rewrite the rules line
 *   node scripts/gen-abandon-policy.js --check  exit 1 when they differ (rules-tests check it too)
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/core/abandonPolicy.ts'), 'utf8');
const m = src.match(/export const ABANDON_POLICY: AbandonPolicy = '(review|flag|consent)';/);
if (!m) {
  console.error('ABANDON_POLICY not found in src/core/abandonPolicy.ts');
  process.exit(2);
}
const rulesPath = path.join(root, 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
const re = /function abandonPolicy\(\) \{ return '(review|flag|consent)'; \}/;
const cur = rules.match(re);
if (!cur) {
  console.error('abandonPolicy() not found in firestore.rules');
  process.exit(2);
}
if (process.argv.includes('--check')) {
  if (cur[1] !== m[1]) {
    console.error(`firestore.rules abandonPolicy() is '${cur[1]}', src/core/abandonPolicy.ts says '${m[1]}'`);
    process.exit(1);
  }
  console.log(`abandon policy in sync: ${m[1]}`);
} else {
  fs.writeFileSync(rulesPath, rules.replace(re, () => `function abandonPolicy() { return '${m[1]}'; }`));
  console.log(`firestore.rules abandonPolicy() = '${m[1]}'`);
}
