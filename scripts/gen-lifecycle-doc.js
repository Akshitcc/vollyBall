#!/usr/bin/env node
/**
 * 1.4.6 (QA V145): writes docs/LIFECYCLE.md from src/core/lifecycle.ts (the one match lifecycle table).
 *   node scripts/gen-lifecycle-doc.js          rewrite the doc
 *   node scripts/gen-lifecycle-doc.js --check  exit 1 when it is out of date (the core jest suite checks it too)
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { lifecycleMarkdown } = require(path.join(root, 'rules-tests/appSource'))('src/core/lifecycle.ts');
const out = path.join(root, 'docs/LIFECYCLE.md');
const md = lifecycleMarkdown();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== md) {
    console.error('docs/LIFECYCLE.md is out of date: run node scripts/gen-lifecycle-doc.js');
    process.exit(1);
  }
  console.log('docs/LIFECYCLE.md in sync');
} else {
  fs.writeFileSync(out, md);
  console.log('wrote docs/LIFECYCLE.md');
}
