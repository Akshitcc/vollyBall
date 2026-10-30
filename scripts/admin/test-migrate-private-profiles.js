#!/usr/bin/env node
/**
 * 1.5.9: self-test of migrate-private-profiles.js on the LOCAL emulator only (demo-volleylive on 127.0.0.1:8181, started
 * by /workspace/scripts/emulator.sh). Seeds legacy docs with placeholder values, runs a dry run and an apply, checks
 * the result, and that real-project targets are refused. Exit 1 on any failure.
 */
const assert = require('assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkTarget, plan } = require('./migrate-private-profiles');

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST || !/^127\.0\.0\.1:8181$/.test(HOST)) { console.error('Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 (local emulator only)'); process.exit(2); }
const PROJECT = 'demo-volleylive';
const admin = require(path.join(__dirname, '../../server/node_modules/firebase-admin'));
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const run = (...a) => execFileSync(process.execPath, [path.join(__dirname, 'migrate-private-profiles.js'), '--project', PROJECT, ...a], { env: { ...process.env }, encoding: 'utf8' });

(async () => {
  // target guard (pure)
  assert.ok(checkTarget(['--project', 'volleylive-prod'], {}).error, 'no emulator, no --real-project');
  assert.ok(checkTarget(['--project', 'volleylive-prod'], { FIRESTORE_EMULATOR_HOST: HOST }).error, 'emulator but not demo-');
  assert.ok(checkTarget(['--project', 'p1', '--real-project', 'p2'], {}).error, 'ids differ');
  assert.ok(checkTarget(['--project', 'p1', '--real-project', 'p1'], { FIRESTORE_EMULATOR_HOST: HOST }).error, 'real + emulator');
  assert.deepEqual(checkTarget(['--project', PROJECT], { FIRESTORE_EMULATOR_HOST: HOST }), { project: PROJECT, real: false });
  assert.equal(checkTarget(['--project', 'p1', '--real-project', 'p1'], {}).real, true);
  assert.equal(plan('x', { name: 'A' }, false, false).legacy.length, 0);
  // start from an empty LOCAL emulator (the rules suite shares demo-volleylive); only ever a loopback host + demo- project
  assert.ok(/^(127\.0\.0\.1|localhost):\d+$/.test(HOST) && PROJECT.startsWith('demo-'), 'self-test clears only a local demo emulator');
  const clear = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(clear.status, 200, 'emulator cleared');
  // seed (placeholders only)
  const now = Date.now();
  await db.doc('users/m1').set({ id: 'm1', name: 'Mig One', phone: '+919800000101', position: 'setter', city: 'Pune', pushToken: 'ExponentPushToken[placeholder1]', createdAt: now });
  await db.doc('users/m2').set({ id: 'm2', name: 'Mig Two', phone: '+919800000102', position: 'bogus', createdAt: now });
  await db.doc('users/m2/private/profile').set({ phone: '+919800000102', position: 'libero', city: 'Delhi', updatedAt: now });
  await db.doc('users/m3').set({ id: 'm3', name: 'Mig Three', city: 'Agra', createdAt: now }); // no phone, no private doc -> skipped
  await db.doc('users/m4').set({ id: 'm4', name: 'Mig Four', createdAt: now, role: 'x' }); // unknown key only -> reported
  await db.doc('users/m5').set({ id: 'm5', name: 'Mig Five', createdAt: now }); // already clean
  await db.doc('pushTokens/m2').set({ token: 'keep', updatedAt: now });
  const dry = run();
  assert.match(dry, /3 to migrate|2 to migrate/);
  assert.doesNotMatch(dry, /\+91980/, 'never prints a phone number');
  assert.doesNotMatch(dry, /placeholder1/, 'never prints a token');
  assert.equal((await db.doc('users/m1').get()).data().phone, '+919800000101', 'dry run writes nothing');
  const out = run('--apply');
  assert.match(out, /migrated 2/);
  const m1 = (await db.doc('users/m1').get()).data();
  assert.deepEqual(Object.keys(m1).sort(), ['createdAt', 'id', 'name']);
  const p1 = (await db.doc('users/m1/private/profile').get()).data();
  assert.deepEqual({ phone: p1.phone, position: p1.position, city: p1.city }, { phone: '+919800000101', position: 'setter', city: 'Pune' });
  assert.equal((await db.doc('pushTokens/m1').get()).data().token, 'ExponentPushToken[placeholder1]');
  const m2 = (await db.doc('users/m2').get()).data();
  assert.ok(!('phone' in m2) && !('position' in m2));
  assert.equal((await db.doc('users/m2/private/profile').get()).data().position, 'libero', 'an existing private doc is never overwritten');
  assert.equal((await db.doc('pushTokens/m2').get()).data().token, 'keep');
  assert.equal((await db.doc('users/m3').get()).data().city, 'Agra', 'no phone + no private doc: left for a person');
  assert.equal((await db.doc('users/m4').get()).data().role, 'x', 'unknown keys are only reported');
  assert.match(out, /users\/m4: .*other non-public keys \(not touched\): \[role\]/);
  // idempotent
  assert.match(run('--apply'), /migrated 0/);
  // a real-project run is refused while the emulator is set
  let refused = false;
  try { execFileSync(process.execPath, [path.join(__dirname, 'migrate-private-profiles.js'), '--project', 'volleylive-x', '--real-project', 'volleylive-x'], { env: { ...process.env }, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { refused = e.status === 2; }
  assert.ok(refused, 'real project refused (exit 2) while FIRESTORE_EMULATOR_HOST is set');
  for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) { await db.recursiveDelete(db.doc(`users/${id}`)); await db.doc(`pushTokens/${id}`).delete(); }
  console.log('migrate-private-profiles self-test: all passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message || e); process.exit(1); });
