#!/usr/bin/env node
/**
 * 1.4.3 (FB-10, QA info item): one-off admin clean-up for Firebase – blanks the text of daily-item tombstones
 * written by 1.4.1 (deleted: true but textEn / textHi / attribution / sourceUrl still set; they are publicly
 * readable). Since 1.4.2 a delete blanks the text in the same write and firestore.rules (tombstoneOk) only
 * allows scrubbing such an old tombstone – this does the same for all of them at once.
 *
 * NOT run by the release. An admin runs it once per project, with their own Google credentials
 * (Application Default Credentials: `gcloud auth application-default login`, or GOOGLE_APPLICATION_CREDENTIALS
 * pointing at a key file they already have – this script never reads, prints or stores one).
 *
 *   node scripts/admin/scrub-daily-tombstones.js --project <firebase-project-id>            # dry run: lists them
 *   node scripts/admin/scrub-daily-tombstones.js --project <firebase-project-id> --apply    # scrubs them
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node scripts/admin/scrub-daily-tombstones.js --project demo-x --apply
 *
 * What it writes, per tombstone: textEn '', textHi '', attribution null, sourceUrl null – nothing else
 * (deleted, active, removedAt and createdAt stay as they are, so the daily cycle is unchanged).
 * Needs firebase-admin (server/node_modules has it). The API server (MySQL) needs nothing: its deletes blank the
 * text since 1.4.2, and its public list sends a tombstone as id + timestamps only, so an older row's text is
 * never public (it stays in the database for the admin; an UPDATE … WHERE deleted = 1 can blank it if wanted).
 */
const path = require('path');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const project = arg('--project');
const apply = process.argv.includes('--apply');
if (!project) {
  console.error('Usage: scrub-daily-tombstones.js --project <firebase-project-id> [--apply]');
  process.exit(2);
}
let admin;
try {
  admin = require('firebase-admin');
} catch {
  admin = require(path.join(__dirname, '../../server/node_modules/firebase-admin'));
}

const BLANK = { textEn: '', textHi: '', attribution: null, sourceUrl: null };
const hasText = (d) => (d.textEn ?? '') !== '' || (d.textHi ?? '') !== '' || d.attribution != null || d.sourceUrl != null;

async function main() {
  admin.initializeApp({ projectId: project });
  const db = admin.firestore();
  const snap = await db.collection('dailyItems').where('deleted', '==', true).get();
  const todo = snap.docs.filter((d) => hasText(d.data()));
  console.log(`${project}: ${snap.size} tombstone(s), ${todo.length} still with text${apply ? '' : ' (dry run – add --apply to scrub)'}`);
  for (const d of todo) console.log(`  dailyItems/${d.id}  ${JSON.stringify((d.data().textEn ?? '').slice(0, 40))}`);
  if (!apply || !todo.length) return;
  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    for (const d of todo.slice(i, i + 400)) batch.update(d.ref, BLANK);
    await batch.commit();
  }
  console.log(`scrubbed ${todo.length}`);
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message || e);
    process.exit(1);
  },
);
