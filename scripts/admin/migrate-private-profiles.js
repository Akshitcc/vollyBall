#!/usr/bin/env node
/**
 * 1.5.9 (Tester F158-3) – Firebase data migration: moves the non-public profile fields of users/{uid} docs written by
 * 1.5.8 and earlier into the owner-only users/{uid}/private/profile doc (the 1.5.9 firestore.rules refuse them on the
 * public doc). Per user doc that still has any of phone / position / city / pushToken:
 *   - users/{uid}/private/profile  created with { phone, position, city, updatedAt } when it doesn't exist yet
 *                                   (an existing one is never overwritten – the app may already have moved it)
 *   - pushTokens/{uid}              created with { token, updatedAt } from a legacy pushToken when it doesn't exist
 *   - users/{uid}                   phone / position / city / pushToken deleted (FieldValue.delete())
 * Any OTHER key that isn't a 1.5.9 public field is only REPORTED (the rules' hasOnly() would refuse the owner's next
 * save while it is there) – decide per key; this script never deletes it.
 * The app does the same move for its own user on the next sign-in (firebaseBackend moveLegacyProfile); this script
 * covers everyone at once, before or right after the 1.5.9 rules are deployed (DEPLOY.md, "1.5.9").
 *
 * LOCAL-ONLY BY DEFAULT. NOT run by the release, never run by the build agent on a real project.
 *   Emulator (default; FIRESTORE_EMULATOR_HOST must be set and the project id must start with "demo-"):
 *     FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node scripts/admin/migrate-private-profiles.js --project demo-volleylive            # dry run
 *     FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 node scripts/admin/migrate-private-profiles.js --project demo-volleylive --apply    # writes
 *   A real project – ONLY with Akshit's approval (DEPLOY.md), with the admin's own Application Default Credentials
 *   (this script never reads, prints or stores a key), the project id typed twice, and FIRESTORE_EMULATOR_HOST unset:
 *     node scripts/admin/migrate-private-profiles.js --project <id> --real-project <id>             # dry run first
 *     node scripts/admin/migrate-private-profiles.js --project <id> --real-project <id> --apply
 * Needs firebase-admin (server/node_modules has it).
 */
const path = require('path');

const PUBLIC_KEYS = ['id', 'name', 'photoURL', 'createdAt', 'updatedAt', 'firstName', 'lastName']; // = firebaseProfileDocs.ts PUBLIC_PROFILE_KEYS
const LEGACY_KEYS = ['phone', 'position', 'city', 'pushToken']; // = LEGACY_PUBLIC_KEYS
const POSITIONS = ['setter', 'outside', 'middle', 'opposite', 'libero', 'any'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Refuses anything but the emulator unless the real project is confirmed explicitly. Exported for the self-test. */
function checkTarget(argv, env) {
  const get = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const project = get('--project');
  const real = get('--real-project');
  if (!project) return { error: 'Usage: migrate-private-profiles.js --project <id> [--real-project <id>] [--apply]' };
  const emulator = env.FIRESTORE_EMULATOR_HOST;
  if (real === undefined) {
    if (!emulator) return { error: 'Refused: FIRESTORE_EMULATOR_HOST is not set. This script targets the local emulator unless --real-project <id> is given (needs Akshit\'s approval – DEPLOY.md).' };
    if (!project.startsWith('demo-')) return { error: `Refused: "${project}" is not a demo- project id (emulator runs use demo-*).` };
    return { project, real: false };
  }
  if (emulator) return { error: 'Refused: --real-project given while FIRESTORE_EMULATOR_HOST is set – unset it for a real project, or drop --real-project for the emulator.' };
  if (real !== project) return { error: 'Refused: --real-project must repeat the --project id exactly.' };
  if (project.startsWith('demo-')) return { error: 'Refused: a demo- id is not a real project.' };
  return { project, real: true };
}

/** What one legacy user doc needs (pure; exported for the self-test). */
function plan(uid, d, hasPrivate, hasPushDoc) {
  const legacy = LEGACY_KEYS.filter((k) => k in d);
  const unknown = Object.keys(d).filter((k) => !PUBLIC_KEYS.includes(k) && !LEGACY_KEYS.includes(k));
  if (!legacy.length) return { uid, legacy, unknown, createPrivate: null, createPush: null };
  const phone = typeof d.phone === 'string' ? d.phone : null;
  const createPrivate = !hasPrivate && phone
    ? { phone, position: POSITIONS.includes(d.position) ? d.position : null, city: typeof d.city === 'string' && d.city.trim() ? d.city.slice(0, 80) : null }
    : null;
  const createPush = !hasPushDoc && typeof d.pushToken === 'string' && d.pushToken ? { token: d.pushToken } : null;
  // without a phone and without a private doc the owner's profile would lose its number: keep the doc for a person to look at
  const blocked = !hasPrivate && !phone;
  return { uid, legacy, unknown, createPrivate, createPush, blocked };
}

async function main() {
  const t = checkTarget(process.argv, process.env);
  if (t.error) { console.error(t.error); process.exit(2); }
  const apply = process.argv.includes('--apply');
  let admin;
  try { admin = require('firebase-admin'); } catch { admin = require(path.join(__dirname, '../../server/node_modules/firebase-admin')); }
  admin.initializeApp({ projectId: t.project });
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;
  const users = await db.collection('users').get();
  const plans = [];
  for (const u of users.docs) {
    const d = u.data();
    if (!LEGACY_KEYS.some((k) => k in d) && !Object.keys(d).some((k) => !PUBLIC_KEYS.includes(k))) continue;
    const [priv, push] = await Promise.all([db.doc(`users/${u.id}/private/profile`).get(), db.doc(`pushTokens/${u.id}`).get()]);
    plans.push(plan(u.id, d, priv.exists, push.exists));
  }
  const todo = plans.filter((p) => p.legacy.length && !p.blocked);
  console.log(`${t.real ? 'REAL PROJECT' : 'emulator'} ${t.project}: ${users.size} user doc(s), ${todo.length} to migrate${apply ? '' : ' (dry run – add --apply to write)'}`);
  for (const p of plans) {
    // never prints a phone number or a token – only which keys move
    console.log(`  users/${p.uid}: move [${p.legacy.join(', ')}]${p.createPrivate ? ' + create private/profile' : ''}${p.createPush ? ' + create pushTokens' : ''}${p.blocked ? ' – SKIPPED: no phone and no private/profile (check by hand)' : ''}${p.unknown.length ? `  · other non-public keys (not touched): [${p.unknown.join(', ')}]` : ''}`);
  }
  if (!apply) return;
  if (!todo.length) { console.log('migrated 0 (nothing to do)'); return; }
  let n = 0;
  for (const p of todo) {
    await db.runTransaction(async (tx) => {
      const pubRef = db.doc(`users/${p.uid}`), privRef = db.doc(`users/${p.uid}/private/profile`), pushRef = db.doc(`pushTokens/${p.uid}`);
      const [pub, priv, push] = await Promise.all([tx.get(pubRef), tx.get(privRef), tx.get(pushRef)]);
      if (!pub.exists) return;
      const q = plan(p.uid, pub.data(), priv.exists, push.exists); // re-checked inside the transaction
      if (!q.legacy.length || q.blocked) return;
      if (q.createPrivate) tx.set(privRef, { ...q.createPrivate, updatedAt: FieldValue.serverTimestamp() });
      if (q.createPush) tx.set(pushRef, { ...q.createPush, updatedAt: Date.now() });
      tx.update(pubRef, Object.fromEntries(q.legacy.map((k) => [k, FieldValue.delete()])));
      n++;
    });
  }
  console.log(`migrated ${n}`);
}

module.exports = { checkTarget, plan, PUBLIC_KEYS, LEGACY_KEYS };
if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error(e.message || e); process.exit(1); });
}
