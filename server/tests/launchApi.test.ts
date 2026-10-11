/**
 * Launch prep (with the test database): /health with a DB ping, request ids, the CORS allowlist, the
 * object-storage redirect, the migration lock, and server-side SMS OTP end to end – hashed storage,
 * expiry, attempt and resend limits, sessions and sign-out – plus the Firebase Phone Auth exchange.
 * Providers are fakes: no SMS, no network.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app';
import { OtpService, DEFAULT_OTP_LIMITS } from '../src/auth/otp/otpService';
import { DevOtpProvider, FirebasePhoneProvider, Msg91Provider } from '../src/auth/otp/providers';
import { CompositeVerifier, createSession, SessionSigner, SessionTokenVerifier } from '../src/auth/otp/sessions';
import { StaticTokenVerifier } from '../src/auth/verifier';
import type { Services } from '../src/context';
import { migrate, migrateLocked } from '../src/db/migrate';
import { RateLimiter } from '../src/rateLimit';
import { FileLinkSigner } from '../src/storage/photoStorage';
import { S3Storage } from '../src/storage/s3Storage';
import { ADMIN, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => h.reset());

const SECRET = 'launch-test-session-secret-'.repeat(2);
const PHONE = '+919812345678';

describe('ops endpoints', () => {
  it('/health pings the database and reports pluggable backends (no secrets); /healthz is liveness', async () => {
    const app = createApp({ ...h.s, info: { version: '9.9.9', storage: 's3', rateStore: 'memory', auth: 'otp:msg91' } });
    const r = await request(app).get('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.db, 'ok');
    assert.equal(r.body.storage, 's3');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.ok(!JSON.stringify(r.body).match(/mysql:|secret|password/i));
    assert.equal((await request(app).get('/healthz')).body.ok, true);
    // a dead database → 503, still no details
    const broken = createApp({ ...h.s, db: { raw: async () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5')) } as unknown as Services['db'] });
    const d = await request(broken).get('/health');
    assert.equal(d.status, 503);
    assert.deepEqual(d.body, { ok: false, db: 'down' });
  });
  it('every response carries X-Request-Id (a valid proxy id is kept); security headers are set', async () => {
    const a = await h.api.get('/healthz');
    assert.match(a.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.equal(a.headers['x-content-type-options'], 'nosniff');
    const b = await h.api.get('/healthz').set('X-Request-Id', 'edge-1234abcd');
    assert.equal(b.headers['x-request-id'], 'edge-1234abcd');
  });
  it('CORS: only allowlisted origins get CORS headers', async () => {
    const ok = await h.api.options('/api/me').set('Origin', 'http://localhost:8081');
    assert.equal(ok.status, 204);
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:8081');
    const no = await h.api.options('/api/me').set('Origin', 'https://evil.example');
    assert.equal(no.headers['access-control-allow-origin'], undefined);
  });
  it('object storage: a valid /files link redirects to a short-lived presigned URL; a bad link is refused first', async () => {
    const links = new FileLinkSigner(h.s.publicBaseUrl, 'k'.repeat(40), 600);
    const s3 = new S3Storage({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'vl', region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK' }, links, async () => {
      throw new Error('no network in tests');
    });
    const app = createApp({ ...h.s, storage: s3 });
    const key = 'matches/m1/cap/p1.jpg';
    const u = new URL(s3.url(key));
    const r = await request(app).get(`/files/${key}${u.search}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/vl\/matches\/m1\/cap\/p1\.jpg\?X-Amz-Algorithm=/);
    assert.equal((await request(app).get(`/files/${key}?exp=1&sig=x`)).status, 403);
  });
  it('migrations: the locked runner is idempotent and safe to start twice at once', async () => {
    const [a, b] = await Promise.all([migrateLocked(h.db), migrateLocked(h.db)]);
    assert.deepEqual([...a, ...b], []); // already applied by the harness
    const tables = (await h.db.raw("SHOW TABLES LIKE 'otp_challenges'"))[0];
    assert.equal(tables.length, 1);
    assert.deepEqual(await migrate(h.db), []);
  });
});

function otpApp(provider = new DevOtpProvider() as DevOtpProvider | Msg91Provider | FirebasePhoneProvider, limits = DEFAULT_OTP_LIMITS, now: () => number = Date.now) {
  const signer = new SessionSigner(SECRET, 3600, now);
  const otp = new OtpService(h.db, provider, signer, SECRET, new RateLimiter(), limits, now);
  const sessions = new SessionTokenVerifier(h.db, signer);
  const fb = provider instanceof FirebasePhoneProvider ? new StaticTokenVerifier({ 'fb-id-token': { uid: 'firebaseUid1', phone: PHONE } }) : null;
  const app = createApp({ ...h.s, verifier: fb ? new CompositeVerifier([sessions, fb]) : sessions, auth: { otp, signer } });
  return { app, otp, signer };
}

describe('server-side SMS OTP (AUTH_MODE=otp)', () => {
  it('request → verify → session works on /api; stored rows hold only hashes; sign-out revokes', async () => {
    const dev = new DevOtpProvider();
    const { app, otp } = otpApp(dev);
    const r = await request(app).post('/auth/otp/request').send({ phone: PHONE });
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { ttlSeconds: 300, resendAfter: 30 });
    assert.deepEqual(dev.sent, [PHONE]);
    const row = await h.db('otp_challenges').first();
    assert.equal(row.phone_hash, otp.phoneHash(PHONE));
    assert.ok(!JSON.stringify(row).includes('9812345678') && !JSON.stringify(row).includes('123456'));
    const v = await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    assert.equal(v.status, 200);
    assert.match(v.body.token, /^vls1\./);
    assert.match(v.body.uid, /^u_[0-9a-f]{24}$/);
    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${v.body.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.uid, v.body.uid);
    assert.equal(me.body.phone, PHONE);
    // the code works once
    assert.equal((await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '123456' })).body.error, 'otp_expired');
    // sign-out revokes the session at once
    assert.equal((await request(app).post('/auth/logout').set('Authorization', `Bearer ${v.body.token}`)).status, 204);
    assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${v.body.token}`)).status, 401);
  });
  it('an existing account signs in to its own uid', async () => {
    await h.db('users').insert({ id: 'cap', name: 'Captain', phone: PHONE, position: 'any', created_at: new Date(), updated_at: new Date() }).catch(async () => {
      await h.db('users').where({ id: 'cap' }).update({ phone: PHONE });
    });
    const { app } = otpApp();
    await request(app).post('/auth/otp/request').send({ phone: PHONE });
    const v = await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    assert.equal(v.body.uid, 'cap');
  });
  it('wrong codes count down; after the limit even the right code is refused', async () => {
    const { app } = otpApp(new DevOtpProvider(), { ...DEFAULT_OTP_LIMITS, maxAttempts: 3 });
    await request(app).post('/auth/otp/request').send({ phone: PHONE });
    const a = await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '000000' });
    assert.equal(a.status, 400);
    assert.equal(a.body.error, 'otp_invalid');
    assert.equal(a.body.attemptsLeft, 2);
    await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '000001' });
    const c = await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '000002' });
    assert.equal(c.body.error, 'otp_too_many_attempts');
    const d = await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '123456' });
    assert.equal(d.status, 429);
    assert.equal(d.body.error, 'otp_too_many_attempts');
  });
  it('parallel guesses cannot exceed the attempt limit', async () => {
    const { app } = otpApp(new DevOtpProvider(), { ...DEFAULT_OTP_LIMITS, maxAttempts: 3 });
    await request(app).post('/auth/otp/request').send({ phone: PHONE });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => request(app).post('/auth/otp/verify').send({ phone: PHONE, code: String(100000 + i) })));
    const counted = (await h.db('otp_challenges').first('attempts')).attempts;
    assert.equal(counted, 3);
    assert.equal(rs.filter((r) => r.body.error === 'otp_too_many_attempts' && r.status === 429).length, 5);
  });
  it('codes expire; resend has a cooldown and an hourly cap per number; a new code replaces the old one', async () => {
    let now = Date.parse('2026-10-11T08:00:00Z');
    const { app } = otpApp(new DevOtpProvider(), { ...DEFAULT_OTP_LIMITS, maxPerHour: 3 }, () => now);
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: PHONE })).status, 202);
    const wait = await request(app).post('/auth/otp/request').send({ phone: PHONE });
    assert.equal(wait.status, 429);
    assert.equal(wait.body.error, 'otp_resend_wait');
    assert.equal(wait.body.retryAfter, 30);
    now += 301_000; // expired
    assert.equal((await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: '123456' })).body.error, 'otp_expired');
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: PHONE })).status, 202);
    now += 31_000;
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: PHONE })).status, 202);
    assert.equal((await h.db('otp_challenges').whereNull('consumed_at')).length, 1); // only the newest is open
    now += 31_000;
    const cap = await request(app).post('/auth/otp/request').send({ phone: PHONE });
    assert.equal(cap.body.error, 'otp_too_many');
    assert.ok(cap.body.retryAfter > 0);
  });
  it('per-IP limit and phone validation', async () => {
    const { app } = otpApp(new DevOtpProvider(), { ...DEFAULT_OTP_LIMITS, ipPerHour: 2, resendSeconds: 0 });
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: '+919800000001' })).status, 202);
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: '+919800000002' })).status, 202);
    const r = await request(app).post('/auth/otp/request').send({ phone: '+919800000003' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'rate_limited');
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: '+15551234567' })).body.error, 'invalid_phone');
  });
  it('MSG91: the generated code is sent through the (fake) Flow API and verifies; a send failure does not use up a slot', async () => {
    let sentCode = '';
    let fail = true;
    const msg91 = new Msg91Provider({ authKey: 'fake', templateId: 'tmpl' }, async (_u, init) => {
      if (fail) return { ok: false, status: 500, text: async () => '' };
      sentCode = JSON.parse(init.body).recipients[0].otp;
      return { ok: true, status: 200, text: async () => '{"type":"success"}' };
    });
    const { app } = otpApp(msg91);
    const e = await request(app).post('/auth/otp/request').send({ phone: PHONE });
    assert.equal(e.status, 502);
    assert.equal(e.body.error, 'otp_send_failed');
    assert.equal((await h.db('otp_challenges')).length, 0);
    fail = false;
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: PHONE })).status, 202);
    assert.match(sentCode, /^\d{6}$/);
    assert.equal((await request(app).post('/auth/otp/verify').send({ phone: PHONE, code: sentCode })).status, 200);
  });
  it('Firebase Phone Auth: the device does the SMS; a verified ID token becomes a session (and still works directly)', async () => {
    const fb = new FirebasePhoneProvider(new StaticTokenVerifier({ 'fb-id-token': { uid: 'firebaseUid1', phone: PHONE } }));
    const { app } = otpApp(fb);
    assert.equal((await request(app).post('/auth/otp/request').send({ phone: PHONE })).body.error, 'otp_use_device');
    assert.equal((await request(app).post('/auth/firebase').send({ idToken: 'forged' })).status, 401);
    const x = await request(app).post('/auth/firebase').send({ idToken: 'fb-id-token' });
    assert.equal(x.status, 200);
    assert.equal(x.body.uid, 'firebaseUid1');
    assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${x.body.token}`)).body.uid, 'firebaseUid1');
    assert.equal((await request(app).get('/api/me').set('Authorization', 'Bearer fb-id-token')).body.uid, 'firebaseUid1');
    assert.equal((await request(app).get('/auth/config')).body.mode, 'device');
  });
  it('admin role stays server-side: a session for a non-admin cannot review; ADMIN_UIDS can', async () => {
    const { app, signer } = otpApp();
    const user = await createSession(h.db, signer, 'eve', null);
    const admin = await createSession(h.db, signer, ADMIN.uid, null);
    assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${user.token}`)).body.isAdmin, false);
    assert.equal((await request(app).get('/api/me').set('Authorization', `Bearer ${admin.token}`)).body.isAdmin, true);
  });
});
