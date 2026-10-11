/**
 * Build 1.2.1 photo fixes (retest 1.1.0 NB-P1…P4 and the 1.1.0 browser pass):
 *  - the client-side byte check, the same for every backend (allow-list, magic bytes, size min/max);
 *  - a dead blob: URL is a permanent error (dropped at once, not retried for 7 days);
 *  - the queue belongs to the signed-in account (sign-out clears it, other accounts' items are never uploaded);
 *  - one idempotency key per queued photo (API header; Firebase reuses the uploaded file);
 *  - the queued / uploading / added chip behaves the same in demo, API and Firebase modes.
 */
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { checkPhotoProbe, PHOTO_ACCEPT } from '../../core/photos';
import { isPermanentUploadError } from '../../core/uploadQueue';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));

let mockCurrent: unknown;
jest.mock('../backend', () => ({
  get backend() {
    return mockCurrent;
  },
}));

// ---- a tiny fake Firebase (only what uploadMatchPhoto / deleteMatchPhoto use) ----
const mockFb = { docs: new Map<string, Record<string, unknown>>(), files: new Map<string, string>(), uploads: 0, setDocFails: 0 };
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  getDoc: async (r: { path: string }) => ({ exists: () => mockFb.docs.has(r.path), data: () => mockFb.docs.get(r.path), id: r.path.split('/').pop() }),
  setDoc: async (r: { path: string }, d: Record<string, unknown>) => {
    if (mockFb.setDocFails > 0) {
      mockFb.setDocFails--;
      throw Object.assign(new Error('Could not reach Cloud Firestore backend'), { code: 'unavailable' });
    }
    mockFb.docs.set(r.path, d);
  },
  deleteDoc: async (r: { path: string }) => void mockFb.docs.delete(r.path),
  serverTimestamp: () => 'SERVER_TS',
  // 1.3.4: the photo list of a match – same-image lookup (where hash ==) and the per-match count
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  where: (field: string, _op: string, value: unknown) => ({ field, value }),
  limit: (n: number) => ({ n }),
  query: (c: { path: string }, ...cons: { field?: string; value?: unknown }[]) => ({ path: c.path, cons }),
  getDocs: async (q: { path: string; cons: { field?: string; value?: unknown }[] }) => {
    const rows = [...mockFb.docs.entries()].filter(([k, d]) => k.startsWith(`${q.path}/`) && q.cons.every((c) => !c.field || d[c.field] === c.value));
    return { empty: rows.length === 0, size: rows.length, docs: rows.map(([k, d]) => ({ id: k.split('/').pop(), data: () => d })) };
  },
  // 1.3.5: photo + counter (photoMeta/count) written together in one transaction; a failed commit writes nothing
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    const writes: [string, Record<string, unknown> | null][] = [];
    const tx = {
      get: async (r: { path: string }) => ({ exists: () => mockFb.docs.has(r.path), data: () => mockFb.docs.get(r.path), id: r.path.split('/').pop() }),
      set: (r: { path: string }, d: Record<string, unknown>) => void writes.push([r.path, d]),
      delete: (r: { path: string }) => void writes.push([r.path, null]),
    };
    const out = await fn(tx);
    if (mockFb.setDocFails > 0) {
      mockFb.setDocFails--;
      throw Object.assign(new Error('Could not reach Cloud Firestore backend'), { code: 'unavailable' });
    }
    for (const [k, d] of writes) (d ? mockFb.docs.set(k, d) : mockFb.docs.delete(k));
    return out;
  },
}));
const photoDocs = (m: string) => [...mockFb.docs.entries()].filter(([k]) => k.startsWith(`matches/${m}/photos/`));
jest.mock('firebase/storage', () => ({
  ref: (_s: unknown, path: string) => ({ path }),
  getDownloadURL: async (r: { path: string }) => {
    const u = mockFb.files.get(r.path);
    if (!u) throw Object.assign(new Error('Object does not exist'), { code: 'storage/object-not-found' });
    return u;
  },
  uploadBytesResumable: (r: { path: string }) => {
    mockFb.uploads++;
    const p = Promise.resolve().then(() => void mockFb.files.set(r.path, `https://firebasestorage.googleapis.com/v0/b/x/o/${encodeURIComponent(r.path)}`));
    return Object.assign(p, { on: (_e: string, cb: (x: { bytesTransferred: number; totalBytes: number }) => void) => cb({ bytesTransferred: 1, totalBytes: 2 }) });
  },
  deleteObject: async (r: { path: string }) => void mockFb.files.delete(r.path),
  uploadBytes: async () => {},
}));
jest.mock('firebase/auth', () => ({}));
jest.mock('../firebase', () => ({ getFirebase: () => ({ auth: { currentUser: { uid: 'a1' } }, db: {}, storage: {} }) }));

// ---- files: a fake Blob + fetch for local URIs ----
class FakeBlob {
  constructor(private bytes: Uint8Array, readonly type: string, private fakeSize?: number) {}
  get size() {
    return this.fakeSize ?? this.bytes.length;
  }
  slice(a: number, b: number) {
    if (this.fakeSize != null) return new FakeBlob(this.bytes.slice(0, Math.min(b - a, this.bytes.length)), '');
    return new FakeBlob(this.bytes.slice(a, b), '');
  }
  async arrayBuffer() {
    return this.bytes.slice().buffer;
  }
}
const pad = (head: number[], n: number, tail: number[] = []) => new Uint8Array([...head, ...new Array(Math.max(0, n - head.length - tail.length)).fill(0), ...tail]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0], 300);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 120);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' + ' '.repeat(100));
const TXT = new TextEncoder().encode('hello, this is a text file renamed to photo.jpg'.repeat(5));
const files: Record<string, FakeBlob> = {};
type Net = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<unknown>;
let api: Net = async () => {
  throw new TypeError('Network request failed');
};
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    if (/^(file|blob|content):/.test(url)) {
      const f = files[url];
      if (!f) throw new TypeError('Failed to fetch'); // a dead blob: URL after a reload
      return { ok: true, status: 200, blob: async () => f };
    }
    return api(url, init);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  files['file:///a.jpg'] = new FakeBlob(JPEG, 'image/jpeg');
  files['file:///b.png'] = new FakeBlob(PNG, '');
  files['file:///c.png'] = new FakeBlob(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 140), ''); // 1.3.4: another image
  files['blob:svg'] = new FakeBlob(SVG, 'image/svg+xml');
  files['file:///notes.jpg'] = new FakeBlob(TXT, 'image/jpeg');
  files['file:///big.jpg'] = new FakeBlob(JPEG, 'image/jpeg', 11 * 1024 * 1024);
  files['file:///empty.jpg'] = new FakeBlob(new Uint8Array(0), 'image/jpeg');
  files['file:///gifhead.gif'] = new FakeBlob(new TextEncoder().encode('GIF89a\x01\x00\x01\x00'), 'image/gif');
});

describe('client-side photo check (every backend)', () => {
  const { readPhoto } = require('../photoFile');
  it('accepts real images by their bytes; refuses SVG, a renamed text file, empty, too large, truncated', async () => {
    await expect(readPhoto('file:///a.jpg')).resolves.toMatchObject({ type: 'image/jpeg', ext: 'jpg', size: 300 });
    await expect(readPhoto('file:///b.png')).resolves.toMatchObject({ type: 'image/png', ext: 'png' }); // no declared type: sniffed
    await expect(readPhoto('blob:svg')).rejects.toMatchObject({ code: 'photo_type' });
    await expect(readPhoto('file:///notes.jpg')).rejects.toMatchObject({ code: 'photo_type' }); // declared JPEG, bytes are text
    await expect(readPhoto('file:///empty.jpg')).rejects.toMatchObject({ code: 'photo_empty' });
    await expect(readPhoto('file:///big.jpg')).rejects.toMatchObject({ code: 'photo_too_large' });
    await expect(readPhoto('file:///gifhead.gif')).rejects.toMatchObject({ code: 'photo_truncated' });
    // JPEG bytes declared as SVG by the picker: refused (never relabelled)
    await expect(readPhoto('file:///a.jpg', 'image/svg+xml')).rejects.toMatchObject({ code: 'photo_type' });
  });
  it('a dead blob: URL is a permanent error (dropped at once, not retried for 7 days)', async () => {
    const e = await readPhoto('blob:http://localhost/gone').catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'photo_unreadable' });
    expect(isPermanentUploadError(e)).toBe(true);
    expect(isPermanentUploadError({ code: 'photo_wrong_account' })).toBe(true);
    expect(isPermanentUploadError(new TypeError('Network request failed'))).toBe(false);
  });
  it('checkPhotoProbe and the picker accept list', () => {
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp,image/heic,image/gif');
    expect(PHOTO_ACCEPT.startsWith(',')).toBe(false);
    const head = JPEG.slice(0, 32);
    expect(checkPhotoProbe({ declaredType: 'image/jpg', size: 300, head, last: 0 })).toEqual({ type: 'image/jpeg', ext: 'jpg' });
    expect(checkPhotoProbe({ declaredType: 'application/octet-stream', size: 300, head, last: 0 })).toEqual({ type: 'image/jpeg', ext: 'jpg' });
    expect(checkPhotoProbe({ declaredType: 'text/plain', size: 300, head, last: 0 })).toEqual({ error: 'photo_type' });
    expect(checkPhotoProbe({ declaredType: 'image/jpeg', size: 99, head, last: 0 })).toEqual({ error: 'photo_truncated' });
    expect(checkPhotoProbe({ declaredType: 'image/jpeg', size: 10 * 1024 * 1024, head, last: 0 })).toEqual({ error: 'photo_too_large' });
  });
});

describe('the queue belongs to the account', () => {
  const { photoQueue, QUEUE_KEY } = require('../photoQueue');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const fake = { uploadMatchPhoto: jest.fn(async () => {}), signOut: jest.fn(async () => {}) };
  beforeEach(async () => {
    mockCurrent = fake;
    jest.clearAllMocks();
    await photoQueue._reset();
  });
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

  it('only the signed-in user’s photos are uploaded; another account’s are dropped when this user signs in', async () => {
    await photoQueue.setUser('b9');
    fake.uploadMatchPhoto.mockRejectedValueOnce(new TypeError('Network request failed'));
    await photoQueue.add('m1', 'b9', 'file:///a.jpg'); // b9 offline: stays queued
    expect(photoQueue._items()).toHaveLength(1);
    await photoQueue.setUser(null); // signed out elsewhere (token expired): nothing uploads
    photoQueue.retryNow();
    await settle();
    expect(fake.uploadMatchPhoto).toHaveBeenCalledTimes(1);
    await photoQueue.setUser('a1'); // someone else signs in on this device
    await settle();
    expect(photoQueue._items()).toEqual([]);
    expect(fake.uploadMatchPhoto).toHaveBeenCalledTimes(1); // b9's photo was never sent with a1's token
  });

  it('sign-out clears the queue before signing out', async () => {
    const { signOut } = require('../session');
    await photoQueue.setUser('a1');
    fake.uploadMatchPhoto.mockRejectedValue(new TypeError('Network request failed'));
    await photoQueue.add('m1', 'a1', 'file:///a.jpg');
    expect(JSON.parse(await AsyncStorage.getItem(QUEUE_KEY))).toHaveLength(1);
    await signOut();
    expect(fake.signOut).toHaveBeenCalled();
    expect(photoQueue._items()).toEqual([]);
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBeNull();
    fake.uploadMatchPhoto.mockReset();
  });

  it('every retry of one photo carries the same idempotency key (the queue item id)', async () => {
    await photoQueue.setUser('a1');
    fake.uploadMatchPhoto.mockRejectedValueOnce(new TypeError('Network request failed'));
    await photoQueue.add('m1', 'a1', 'file:///a.jpg');
    const id = photoQueue._items()[0].id;
    await settle();
    photoQueue.retryNow();
    await settle();
    const keys = (fake.uploadMatchPhoto.mock.calls as unknown as unknown[][]).map((c) => (c[4] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual([id, id]);
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('upload chip: same queued / uploading / added states in demo, API and Firebase modes', () => {
  const { UploadChip } = require('../../components/MatchCamera');
  const { photoQueue } = require('../photoQueue');
  const chip = () => screen.queryByTestId('upload-chip-text')?.props.children;
  const settle = (ms = 20) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
  beforeEach(async () => {
    await photoQueue._reset();
  });

  it('API: offline → "Offline · 1 photo waiting"; back online → uploaded once with the same Idempotency-Key', async () => {
    const { ApiBackend } = require('../backend/apiBackend');
    const b = new ApiBackend({
      baseUrl: 'http://api.test',
      tokenSource: { onAuthChanged: (cb: (u: unknown) => void) => (cb({ uid: 'a1', phoneNumber: null }), () => {}), sendOtp: jest.fn(), signOut: jest.fn(), token: async () => 'tok' },
    });
    b.onAuthChanged(() => {});
    mockCurrent = b;
    const posts: Record<string, string>[] = [];
    let online = false;
    api = async (url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/matches/m1/photos')) {
        posts.push(init.headers ?? {});
        if (!online) throw new TypeError('Network request failed');
        return { ok: true, status: 201, text: async () => '{"id":"p1"}' };
      }
      throw new Error('unexpected ' + url);
    };
    await render(<UploadChip matchId="m1" />);
    await act(async () => {
      await photoQueue.add('m1', 'a1', 'file:///a.jpg');
    });
    await settle();
    expect(chip()).toBe('Offline · 1 photo waiting');
    online = true;
    await act(async () => photoQueue.retryNow());
    await settle();
    expect(chip()).toBe('Photo added');
    expect(posts).toHaveLength(2);
    expect(posts[0]['Idempotency-Key']).toMatch(/^q_/);
    expect(posts[1]['Idempotency-Key']).toBe(posts[0]['Idempotency-Key']);
    expect(posts[1]['Content-Type']).toBe('image/jpeg');
    // a photo queued by another account is refused (permanent) instead of uploaded with this token
    await expect(b.uploadMatchPhoto('m1', 'b9', 'file:///a.jpg')).rejects.toMatchObject({ code: 'photo_wrong_account' });
  });

  it('Firebase: the photo record fails → waiting; the retry reuses the uploaded file (no re-upload, no orphan)', async () => {
    const { FirebaseBackend } = require('../backend/firebaseBackend');
    mockCurrent = new FirebaseBackend();
    mockFb.docs.clear();
    mockFb.files.clear();
    mockFb.uploads = 0;
    mockFb.setDocFails = 1;
    const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}` }));
    mockFb.docs.set('matches/m1', { teamA: { players: players('a') }, teamB: { players: players('b') }, scorerId: 'a1' });
    await render(<UploadChip matchId="m1" />);
    await act(async () => {
      await photoQueue.add('m1', 'a1', 'file:///a.jpg');
    });
    await settle();
    expect(chip()).toBe('Offline · 1 photo waiting');
    expect(mockFb.uploads).toBe(1);
    const key = photoQueue._items()[0].id;
    await act(async () => photoQueue.retryNow());
    await settle();
    expect(chip()).toBe('Photo added');
    expect(mockFb.uploads).toBe(1); // reused
    expect(mockFb.files.size).toBe(1);
    const rows = photoDocs('m1');
    expect(rows).toHaveLength(1);
    const [id, rec] = rows[0];
    expect(id).toBe(`matches/m1/photos/${rec.hash}`); // 1.3.5: the document id is the image hash
    expect(rec).toMatchObject({ storagePath: `matches/m1/a1/${key}.jpg`, uploadedBy: 'a1', key });
    expect(mockFb.docs.get('matches/m1/photoMeta/count')).toEqual({ n: 1, last: rec.hash });
    // a third attempt (lost response) finds the record and does nothing
    await (mockCurrent as { uploadMatchPhoto: (...a: unknown[]) => Promise<void> }).uploadMatchPhoto('m1', 'a1', 'file:///a.jpg', undefined, { idempotencyKey: key });
    expect(mockFb.uploads).toBe(1);
    // unknown types are refused before anything is uploaded
    await expect((mockCurrent as { uploadMatchPhoto: (...a: unknown[]) => Promise<void> }).uploadMatchPhoto('m1', 'a1', 'blob:svg')).rejects.toMatchObject({ code: 'photo_type' });
    expect(mockFb.uploads).toBe(1);
  });

  it('1.3.4 Firebase: the same image twice in a match is refused (hash stored); the 51st photo is refused', async () => {
    const { FirebaseBackend } = require('../backend/firebaseBackend');
    const { MAX_PHOTOS_PER_MATCH } = require('../../core/limits');
    const fb = new FirebaseBackend();
    mockFb.docs.clear();
    mockFb.files.clear();
    mockFb.uploads = 0;
    mockFb.setDocFails = 0;
    const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}` }));
    mockFb.docs.set('matches/m1', { teamA: { players: players('a') }, teamB: { players: players('b') }, scorerId: 'a1' });
    await fb.uploadMatchPhoto('m1', 'a1', 'file:///a.jpg', undefined, { idempotencyKey: 'q_one_0001' });
    const [[id1, doc1]] = photoDocs('m1') as [string, { hash: string; key: string }][];
    expect(doc1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).toBe(`matches/m1/photos/${doc1.hash}`);
    expect(doc1.key).toBe('q_one_0001');
    await expect(fb.uploadMatchPhoto('m1', 'a1', 'file:///a.jpg', undefined, { idempotencyKey: 'q_two_0002' })).rejects.toMatchObject({ code: 'photo_duplicate' });
    expect(mockFb.uploads).toBe(1);
    expect(mockFb.docs.get('matches/m1/photoMeta/count')).toMatchObject({ n: 1 });
    expect(isPermanentUploadError({ code: 'photo_duplicate' })).toBe(true);
    // a different image is fine; at the cap the next one is refused before anything is uploaded
    await fb.uploadMatchPhoto('m1', 'a1', 'file:///b.png', undefined, { idempotencyKey: 'q_three_0003' });
    expect(mockFb.docs.get('matches/m1/photoMeta/count')).toMatchObject({ n: 2 });
    mockFb.docs.set('matches/m1/photoMeta/count', { n: MAX_PHOTOS_PER_MATCH, last: 'x' }); // the counter is the cap source
    const before = mockFb.uploads;
    await expect(fb.uploadMatchPhoto('m1', 'a1', 'file:///c.png', undefined, { idempotencyKey: 'q_four_0004' })).rejects.toMatchObject({ code: 'photo_limit' });
    expect(mockFb.uploads).toBe(before);
    expect(isPermanentUploadError({ code: 'photo_limit' })).toBe(true);
    // deleting a counted photo gives its slot back (same transaction)
    const [, d2] = photoDocs('m1').find(([, d]) => d.key === 'q_three_0003') as [string, { hash: string; storagePath: string }];
    await fb.deleteMatchPhoto({ id: d2.hash, matchId: 'm1', hash: d2.hash, storagePath: d2.storagePath });
    expect(mockFb.docs.get('matches/m1/photoMeta/count')).toEqual({ n: MAX_PHOTOS_PER_MATCH - 1, last: d2.hash });
    expect(photoDocs('m1')).toHaveLength(1);
  });

  it('demo (web): offline → queued chip, not "Photo added"; online → added once', async () => {
    const realOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
    const nav = globalThis as unknown as { navigator: { onLine?: boolean } | undefined };
    const oldNav = nav.navigator;
    nav.navigator = { ...(oldNav ?? {}), onLine: false };
    try {
      const { DemoBackend } = require('../backend/demoBackend');
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const b = new DemoBackend();
      const otp = b.sendOtp('+919000000010'); // seed1, scorer of the seeded live match
      await jest.advanceTimersByTimeAsync(500);
      const done = (await otp).confirm('123456');
      await jest.advanceTimersByTimeAsync(500);
      await done;
      jest.useRealTimers();
      // 1.3.0: every write needs the current T&C accepted (the gate itself is tested in terms130)
      await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
      mockCurrent = b;
      const db = (b as unknown as { db: { matches: Record<string, { scorerId: string; status: string }>; photos: Record<string, unknown> } }).db;
      const mid = Object.keys(db.matches).find((k) => db.matches[k].scorerId === 'seed1')!;
      const before = Object.keys(db.photos).length;
      await render(<UploadChip matchId={mid} />);
      await act(async () => {
        await photoQueue.add(mid, 'seed1', 'file:///a.jpg');
      });
      await settle();
      expect(chip()).toBe('Offline · 1 photo waiting');
      expect(Object.keys(db.photos).length).toBe(before);
      nav.navigator!.onLine = true;
      await act(async () => photoQueue.retryNow());
      await settle();
      expect(chip()).toBe('Photo added');
      expect(Object.keys(db.photos).length).toBe(before + 1);
      // the demo backend runs the same byte check
      await expect(b.uploadMatchPhoto(mid, 'seed1', 'file:///notes.jpg')).rejects.toMatchObject({ code: 'photo_type' });
    } finally {
      Object.defineProperty(Platform, 'OS', { get: () => realOS, configurable: true });
      nav.navigator = oldNav;
    }
  });
});
