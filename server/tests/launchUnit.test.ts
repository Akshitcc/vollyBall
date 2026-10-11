/**
 * Launch prep (unit, no database): production config refusals, managed-MySQL TLS options, JSON logs
 * without personal data, S3 SigV4 signing (AWS's published test vectors) and the S3/R2 adapter against a
 * fake object store, the Redis RESP client + shared rate store against a fake Redis, and the MSG91
 * adapter against a fake HTTP endpoint. No network, no real keys: the AWS values below are the
 * documentation's example credentials.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import { isPlaceholder, loadConfig, parseCorsOrigins } from '../src/config';
import { sslFromEnv } from '../src/db/knex';
import { Logger, logPath, redact, requestLogger } from '../src/ops/logger';
import { encodeCommand, parseReplies, RedisClient } from '../src/ops/redis';
import { RedisRateStore } from '../src/rateStore';
import { RateLimiter } from '../src/rateLimit';
import { FileLinkSigner } from '../src/storage/photoStorage';
import { presignGet, S3Storage, signHeaders, EMPTY_SHA256 } from '../src/storage/s3Storage';
import { DevOtpProvider, Msg91Provider, OtpSendError } from '../src/auth/otp/providers';
import { SessionSigner } from '../src/auth/otp/sessions';

const SECRET = 'x'.repeat(40);
const prodBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://u:p@db.internal:3306/volleylive',
  AUTH_MODE: 'otp',
  OTP_PROVIDER: 'msg91',
  MSG91_AUTH_KEY: 'k',
  MSG91_TEMPLATE_ID: 't',
  SESSION_SECRET: SECRET,
  FILE_URL_SECRET: SECRET,
  PUBLIC_BASE_URL: 'https://api.volley.test',
};

describe('production config', () => {
  it('a complete production config loads (otp + msg91, local storage, memory rate limits)', () => {
    const c = loadConfig(prodBase);
    assert.equal(c.authMode, 'otp');
    assert.equal(c.otp?.provider, 'msg91');
    assert.equal(c.storage.driver, 'local');
    assert.equal(c.redisUrl, '');
    assert.equal(c.otp?.limits.maxAttempts, 5);
  });
  it('refuses AUTH_MODE=dev and OTP_PROVIDER=dev in production', () => {
    assert.throws(() => loadConfig({ ...prodBase, AUTH_MODE: 'dev' }), /AUTH_MODE=dev/);
    assert.throws(() => loadConfig({ ...prodBase, OTP_PROVIDER: 'dev' }), /OTP_PROVIDER=dev/);
    // locally both are fine
    assert.equal(loadConfig({ ...prodBase, NODE_ENV: 'development', AUTH_MODE: 'dev' }).authMode, 'dev');
    assert.equal(loadConfig({ ...prodBase, NODE_ENV: 'development', OTP_PROVIDER: 'dev' }).otp?.provider, 'dev');
  });
  it('refuses short or placeholder secrets, http base URL, missing provider keys', () => {
    assert.throws(() => loadConfig({ ...prodBase, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
    assert.throws(() => loadConfig({ ...prodBase, SESSION_SECRET: 'replace-with-at-least-32-random-characters' }), /placeholder/);
    assert.throws(() => loadConfig({ ...prodBase, FILE_URL_SECRET: 'replace-with-at-least-32-random-characters' }), /placeholder/);
    assert.throws(() => loadConfig({ ...prodBase, PUBLIC_BASE_URL: 'http://api.volley.test' }), /https/);
    assert.throws(() => loadConfig({ ...prodBase, MSG91_AUTH_KEY: '' }), /MSG91_AUTH_KEY/);
    assert.throws(() => loadConfig({ ...prodBase, OTP_PROVIDER: '' }), /OTP_PROVIDER/);
    assert.ok(isPlaceholder('CHANGE_ME') && !isPlaceholder(SECRET));
  });
  it('CORS allowlist: exact origins; "*" and http refused in production', () => {
    assert.deepEqual(parseCorsOrigins('https://app.volley.test, https://www.volley.test/', true), ['https://app.volley.test', 'https://www.volley.test']);
    assert.throws(() => parseCorsOrigins('*', true), /refused in production/);
    assert.throws(() => parseCorsOrigins('http://app.volley.test', true), /https/);
    assert.throws(() => parseCorsOrigins('https://app.volley.test/path', true), /not an origin/);
    assert.deepEqual(parseCorsOrigins('http://localhost:8081', false), ['http://localhost:8081']);
  });
  it('S3 storage needs its four settings; REDIS_URL must be redis://', () => {
    assert.throws(() => loadConfig({ ...prodBase, STORAGE_DRIVER: 's3' }), /S3_ENDPOINT/);
    const c = loadConfig({ ...prodBase, STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'photos', S3_ACCESS_KEY_ID: 'a', S3_SECRET_ACCESS_KEY: 'b' });
    assert.equal(c.storage.driver, 's3');
    assert.throws(() => loadConfig({ ...prodBase, REDIS_URL: 'http://x' }), /REDIS_URL/);
    assert.equal(loadConfig({ ...prodBase, TRUST_PROXY: '1' }).trustProxy, 1);
  });
});

describe('managed MySQL TLS (DATABASE_URL + DB_SSL*)', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----';
  it('off by default; on with DB_SSL=1, ?ssl=true or ?sslmode=require; CA from env text', () => {
    assert.equal(sslFromEnv({}, 'mysql://u:p@h/db'), undefined);
    assert.deepEqual(sslFromEnv({ DB_SSL: '1' }), { rejectUnauthorized: true });
    assert.deepEqual(sslFromEnv({}, 'mysql://u:p@h/db?ssl=true'), { rejectUnauthorized: true });
    assert.deepEqual(sslFromEnv({}, 'mysql://u:p@h/db?sslmode=require'), { rejectUnauthorized: true });
    const s = sslFromEnv({ DB_SSL_CA: PEM })!;
    assert.ok(s.ca!.includes('\nMIIB\n'));
    assert.equal(sslFromEnv({ DB_SSL: '1', DB_SSL_REJECT_UNAUTHORIZED: '0' })!.rejectUnauthorized, false);
    assert.throws(() => sslFromEnv({ DB_SSL_CA: 'not a cert' }), /PEM/);
  });
});

describe('JSON logs: request ids, no personal data or secrets', () => {
  it('redacts phone numbers, tokens, e-mails, signatures and codes', () => {
    const s = redact('user +919876543210 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig a@b.in /files/x?exp=1&sig=abc otp=123456 vls1.abc.def dev:+919876543210');
    for (const leak of ['9876543210', 'eyJhbGci', 'a@b.in', 'sig=abc', 'otp=123456', 'vls1.abc']) assert.ok(!s.includes(leak), `${leak} leaked: ${s}`);
    assert.equal(logPath('/api/users/by-phone/+919876543210?x=1'), '/api/users/by-phone/[number]');
  });
  it('one JSON line per request with reqId, method, path, status, ms; X-Request-Id echoed or created', async () => {
    const lines: string[] = [];
    const l = new Logger('info', (x) => lines.push(x));
    const mw = requestLogger(() => l);
    const run = (hdr?: string) =>
      new Promise<string>((done) => {
        const headers: Record<string, string> = {};
        const listeners: Record<string, () => void> = {};
        const req = { header: (n: string) => (n === 'x-request-id' ? hdr : undefined), method: 'GET', originalUrl: '/api/matches/m1?token=abc', url: '' } as never;
        const res = { statusCode: 200, setHeader: (k: string, v: string) => (headers[k] = v), on: (e: string, f: () => void) => (listeners[e] = f) } as never;
        mw(req, res, () => {
          listeners.finish();
          done(headers['X-Request-Id']);
        });
      });
    assert.equal(await run('abcdef12-proxy-id'), 'abcdef12-proxy-id');
    const made = await run('bad id with spaces');
    assert.match(made, /^[0-9a-f-]{36}$/);
    const rec = JSON.parse(lines[1]);
    assert.deepEqual(Object.keys(rec).sort(), ['level', 'method', 'ms', 'msg', 'path', 'reqId', 'status', 't']);
    assert.equal(rec.path, '/api/matches/m1');
    assert.equal(rec.reqId, made);
    assert.ok(!lines.join('').includes('token=abc'));
    // silent logger writes nothing
    const quiet: string[] = [];
    new Logger('silent', (x) => quiet.push(x)).error('x');
    assert.equal(quiet.length, 0);
  });
});

describe('S3 / R2 adapter (SigV4, no SDK)', () => {
  // AWS documentation example credentials and expected signatures (Signature Version 4 examples).
  const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
  const when = new Date('2013-05-24T00:00:00Z');
  it('header auth matches the published GET Object example', () => {
    const auth = signHeaders(
      AWS,
      'GET',
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
      EMPTY_SHA256,
      when,
    );
    assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('presigned GET matches the published query-auth example', () => {
    const u = presignGet(AWS, new URL('https://examplebucket.s3.amazonaws.com/test.txt'), 86400, when);
    assert.match(u, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  });
  it('put/get/delete against a fake bucket; links stay our signed /files URLs; redirect is presigned', async () => {
    const objects = new Map<string, { body: Buffer; type: string }>();
    const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer }) => {
      calls.push({ method: init.method, url, headers: init.headers });
      assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request,SignedHeaders=(content-type;)?host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
      const key = new URL(url).pathname;
      const out = (status: number, body: Buffer = Buffer.alloc(0), type = '') => ({ status, ok: status < 300, headers: { get: (n: string) => (n === 'content-type' ? type : null) }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) as ArrayBuffer, text: async () => '' });
      if (init.method === 'PUT') return objects.set(key, { body: init.body!, type: init.headers['content-type'] }), out(200);
      if (init.method === 'GET') return objects.has(key) ? out(200, objects.get(key)!.body, objects.get(key)!.type) : out(404);
      objects.delete(key);
      return out(204);
    };
    const links = new FileLinkSigner('https://api.volley.test', SECRET, 3600, () => 1_700_000_000_000);
    const st = new S3Storage({ endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'vl-photos', region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK', presignSeconds: 120 }, links, fakeFetch, () => new Date('2026-10-11T09:00:00Z'));
    const key = 'matches/m1/u1/p1.jpg';
    await st.put(key, Buffer.from('jpegbytes'), 'image/jpeg');
    assert.equal(calls[0].url, 'https://acc.r2.cloudflarestorage.com/vl-photos/matches/m1/u1/p1.jpg');
    assert.equal(calls[0].headers['x-amz-content-sha256'].length, 64);
    const got = await st.get(key);
    assert.equal(got!.data.toString(), 'jpegbytes');
    assert.equal(got!.contentType, 'image/jpeg');
    const url = st.url(key);
    assert.match(url, /^https:\/\/api\.volley\.test\/files\/matches\/m1\/u1\/p1\.jpg\?exp=\d+&sig=/);
    const q = new URL(url).searchParams;
    assert.ok(st.verify(key, q.get('exp')!, q.get('sig')!));
    assert.ok(!st.verify('matches/m1/u1/other.jpg', q.get('exp')!, q.get('sig')!));
    const r = st.redirectUrl(key)!;
    assert.match(r, /^https:\/\/acc\.r2\.cloudflarestorage\.com\/vl-photos\/matches\/m1\/u1\/p1\.jpg\?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AK%2F20261011%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261011T090000Z&X-Amz-Expires=120&X-Amz-SignedHeaders=host&X-Amz-Signature=[0-9a-f]{64}$/);
    await st.delete(key);
    assert.equal(await st.get(key), null);
    assert.throws(() => st.objectUrl('../etc/passwd'), /Invalid storage key/);
    const noRedirect = new S3Storage({ endpoint: 'https://s3.ap-south-1.amazonaws.com', bucket: 'b', region: 'ap-south-1', accessKeyId: 'AK', secretAccessKey: 'SK', redirect: false, forcePathStyle: false }, links, fakeFetch);
    assert.equal(noRedirect.redirectUrl(key), null);
    assert.equal(noRedirect.objectUrl(key).host, 'b.s3.ap-south-1.amazonaws.com');
  });
  it('fails loudly on a store error (no silent data loss)', async () => {
    const st = new S3Storage({ endpoint: 'https://x.test', bucket: 'b', region: 'auto', accessKeyId: 'AK', secretAccessKey: 'SK' }, new FileLinkSigner('https://a', SECRET, 60), async () => ({ status: 500, ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }));
    await assert.rejects(st.put('matches/m/u/p.jpg', Buffer.from('x'), 'image/jpeg'), /PUT failed \(500\)/);
  });
});

/** A fake Redis speaking RESP2: INCR, PEXPIRE, PTTL, PING, AUTH, SELECT. */
async function fakeRedis(password?: string) {
  const data = new Map<string, number>();
  const seen: string[][] = [];
  const server = net.createServer((sock) => {
    let buf: Buffer = Buffer.alloc(0);
    let authed = !password;
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const { replies, rest } = parseReplies(buf);
      buf = rest;
      for (const r of replies) {
        const [cmd, ...args] = (r as string[]).map(String);
        seen.push([cmd, ...args]);
        if (cmd === 'AUTH') {
          authed = args[args.length - 1] === password;
          sock.write(authed ? '+OK\r\n' : '-WRONGPASS invalid password\r\n');
        } else if (!authed) sock.write('-NOAUTH Authentication required.\r\n');
        else if (cmd === 'PING') sock.write('+PONG\r\n');
        else if (cmd === 'SELECT' || cmd === 'PEXPIRE') sock.write(':1\r\n');
        else if (cmd === 'INCR') {
          const n = (data.get(args[0]) ?? 0) + 1;
          data.set(args[0], n);
          sock.write(`:${n}\r\n`);
        } else sock.write('-ERR unknown command\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as net.AddressInfo).port, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('shared rate limits (Redis store) and the in-memory default', () => {
  it('RESP encode/parse round trip, including partial frames and errors', () => {
    assert.equal(encodeCommand(['INCR', 'k']), '*2\r\n$4\r\nINCR\r\n$1\r\nk\r\n');
    const all = Buffer.from('+OK\r\n:42\r\n$3\r\nabc\r\n$-1\r\n*2\r\n:1\r\n$1\r\nx\r\n-ERR bad\r\n$5\r\nhel');
    const { replies, rest } = parseReplies(all);
    assert.deepEqual(replies.slice(0, 5), ['OK', 42, 'abc', null, [1, 'x']]);
    assert.ok(replies[5] instanceof Error);
    assert.equal(rest.toString(), '$5\r\nhel');
  });
  it('a client with AUTH + SELECT counts in shared windows; over the burst it says how long to wait', async () => {
    const r = await fakeRedis('pw-for-test');
    const client = new RedisClient(`redis://:pw-for-test@127.0.0.1:${r.port}/2`);
    try {
      let now = 120_000; // window = burst / perMinute minutes = 2/2 min = 60 s
      const store = new RedisRateStore(client, 'vl:rl:', () => now);
      const rule = { burst: 2, perMinute: 2 };
      assert.equal(await store.take('verify:u1', rule), 0);
      assert.equal(await store.take('verify:u1', rule), 0);
      now += 15_000;
      assert.equal(await store.take('verify:u1', rule), 45);
      assert.equal(await store.take('verify:u2', rule), 0);
      now += 45_000; // next window
      assert.equal(await store.take('verify:u1', rule), 0);
      assert.deepEqual(r.seen[0], ['AUTH', 'pw-for-test']);
      assert.deepEqual(r.seen[1], ['SELECT', '2']);
      assert.ok(r.seen.some((c) => c[0] === 'PEXPIRE'));
      // another instance shares the same counts
      const other = new RedisRateStore(client, 'vl:rl:', () => now);
      assert.equal(await other.take('verify:u1', rule), 0);
      assert.equal(await other.take('verify:u1', rule), 60); // full window left
    } finally {
      await client.close();
      await r.close();
    }
  });
  it('the limiter falls back to memory when Redis is unreachable (the API stays up)', async () => {
    const down = new RedisClient('redis://127.0.0.1:1', 300);
    const l = new RateLimiter({ terms: { burst: 1, perMinute: 1 }, verify: { burst: 1, perMinute: 1 }, matchWrite: { burst: 1, perMinute: 1 } }, Date.now, new RedisRateStore(down));
    assert.equal(await l.takeShared('u1', 'terms'), 0);
    assert.ok((await l.takeShared('u1', 'terms')) > 0);
    await down.close();
  });
});

describe('SMS OTP providers (mocked, no real calls)', () => {
  it('MSG91 Flow API: POST with authkey header, template id and the code in the template variable', async () => {
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const p = new Msg91Provider({ authKey: 'test-auth-key', templateId: 'tmpl-1', otpVar: 'otp' }, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"type":"success","message":"x"}' };
    });
    await p.send('+919876543210', '482913');
    assert.equal(calls[0].url, 'https://control.msg91.com/api/v5/flow');
    assert.equal(calls[0].init.headers.authkey, 'test-auth-key');
    assert.deepEqual(JSON.parse(calls[0].init.body), { template_id: 'tmpl-1', short_url: '0', recipients: [{ mobiles: '919876543210', otp: '482913' }] });
  });
  it('MSG91 errors (HTTP or {"type":"error"}) become OtpSendError without the number or code', async () => {
    const bad = new Msg91Provider({ authKey: 'k', templateId: 't' }, async () => ({ ok: false, status: 401, text: async () => '' }));
    await assert.rejects(bad.send('+919876543210', '111111'), (e: Error) => e instanceof OtpSendError && !e.message.includes('9876543210') && !e.message.includes('111111'));
    const soft = new Msg91Provider({ authKey: 'k', templateId: 't' }, async () => ({ ok: true, status: 200, text: async () => '{"type":"error","message":"DLT"}' }));
    await assert.rejects(soft.send('+919876543210', '111111'), OtpSendError);
    assert.throws(() => new Msg91Provider({ authKey: '', templateId: 't' }), /MSG91_AUTH_KEY/);
  });
  it('dev provider: fixed demo code, nothing sent anywhere', async () => {
    const d = new DevOtpProvider();
    assert.equal(d.fixedCode(), '123456');
    await d.send('+919876543210');
    assert.deepEqual(d.sent, ['+919876543210']);
  });
  it('session tokens: signed, expiring, tamper-evident', () => {
    let now = 1_700_000_000_000;
    const s = new SessionSigner(SECRET, 60, () => now);
    const { token } = s.sign({ sid: 'a'.repeat(32), uid: 'u1', phone: '+919876543210' });
    assert.ok(token.startsWith('vls1.'));
    assert.equal(s.check(token).uid, 'u1');
    const [b, sig] = token.slice(5).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url').toString()), uid: 'admin1' })).toString('base64url');
    assert.throws(() => s.check(`vls1.${forged}.${sig}`), /signature/);
    assert.throws(() => new SessionSigner('x'.repeat(40), 60, () => now).check(token.replace(/.$/, 'A')), /signature/);
    now += 61_000;
    assert.throws(() => s.check(token), /expired/);
    assert.throws(() => new SessionSigner('short'), /32/);
  });
});
