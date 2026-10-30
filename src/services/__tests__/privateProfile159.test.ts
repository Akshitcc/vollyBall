/** 1.5.9 (Tester F158-3): Firebase public / private profile split and the phone-lookup throttle. */
import fs from 'fs';
import path from 'path';
import { legacyKeys, ownView, privateOf, publicView, splitProfile, PUBLIC_PROFILE_KEYS } from '../backend/firebaseProfileDocs';
import { PHONE_LOOKUP_RATE, PHONE_LOOKUP_RULES, phoneLookupWait, resetPhoneLookupWait } from '../../core/phoneLookup';
import type { UserProfile } from '../../core/types';

const legacy = { name: 'Aarav Sharma', phone: '+919000000010', position: 'setter', city: 'Delhi', pushToken: 'tok', photoURL: null, createdAt: 1 };

describe('F158-3 profile docs', () => {
  test('someone else gets the public fields only, even from a legacy doc', () => {
    const p = publicView('u1', legacy) as unknown as Record<string, unknown>;
    expect(p).toEqual({ id: 'u1', name: 'Aarav Sharma', photoURL: null, createdAt: 1, phone: '' });
    expect(p.position).toBeUndefined();
    expect(p.city).toBeUndefined();
    expect(p.pushToken).toBeUndefined();
  });
  test('the owner: private doc first, legacy public copies as the fallback', () => {
    expect(ownView('u1', legacy, null)).toMatchObject({ phone: '+919000000010', position: 'setter', city: 'Delhi' });
    const moved = { name: 'Aarav Sharma', createdAt: 1 };
    expect(ownView('u1', moved, { phone: '+919000000010', position: 'libero', city: 'Pune' })).toMatchObject({ phone: '+919000000010', position: 'libero', city: 'Pune' });
    expect((ownView('u1', legacy, null) as unknown as Record<string, unknown>).pushToken).toBeUndefined();
    expect(privateOf(moved, null)).toEqual({});
  });
  test('legacyKeys lists what must leave the public doc', () => {
    expect(legacyKeys(legacy).sort()).toEqual(['city', 'phone', 'position', 'pushToken']);
    expect(legacyKeys({ name: 'x' })).toEqual([]);
    expect(legacyKeys(null)).toEqual([]);
  });
  test('splitProfile: public keys only on the public doc', () => {
    const p = { id: 'u1', name: 'A B', phone: '+919000000010', position: 'any', city: '', photoURL: null, createdAt: 5, firstName: 'A', lastName: 'B', dob: '2000-01-01', email: 'a@b.in' } as unknown as UserProfile;
    const { pub, priv } = splitProfile(p);
    expect(Object.keys(pub).every((k) => (PUBLIC_PROFILE_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(pub).not.toHaveProperty('phone');
    expect(pub).not.toHaveProperty('dob');
    expect(priv).toEqual({ phone: '+919000000010', position: 'any', city: '' });
  });
  test('the public key list equals the rules profileOk list', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../../../firestore.rules'), 'utf8');
    const m = /function profileOk\(d, ks\) \{\s*return d\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/.exec(rules)!;
    expect(m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort()).toEqual([...PUBLIC_PROFILE_KEYS].sort());
  });
  test('firebaseBackend: saveProfile writes the private profile and strips the legacy copies; lookups are counted', () => {
    const src = fs.readFileSync(path.join(__dirname, '../backend/firebaseBackend.ts'), 'utf8');
    expect(src).toContain("tx.set(doc(this.fb.db, 'users', p0.id, 'private', 'profile')");
    expect(src).toMatch(/legacyKeys\(curPubDoc\)\.map\(\(k\) => \[k, deleteField\(\)\]\)/);
    expect(src).toContain('await this.countLookup(me, phone);');
    expect(src).not.toMatch(/where\('phone'/);
  });
});

describe('F158-3 phone-lookup throttle (the app, both backends\u2019 numbers)', () => {
  beforeEach(() => resetPhoneLookupWait());
  test('the burst passes, the next one waits; another account is separate', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < PHONE_LOOKUP_RATE.user.burst; i++) expect(phoneLookupWait('a', t0)).toBe(0);
    expect(phoneLookupWait('a', t0)).toBeGreaterThan(0);
    expect(phoneLookupWait('b', t0)).toBe(0);
    expect(phoneLookupWait('a', t0 + 60_000 / PHONE_LOOKUP_RATE.user.perMinute + 1)).toBe(0);
  });
  test('the server uses the same numbers', () => {
    const api = fs.readFileSync(path.join(__dirname, '../../../server/src/routes/api.ts'), 'utf8');
    expect(api).toMatch(/import \{ PHONE_LOOKUP_RATE \} from '..\/..\/..\/src\/core\/phoneLookup'/);
    expect(PHONE_LOOKUP_RULES.limit).toBeGreaterThanOrEqual(PHONE_LOOKUP_RATE.user.burst);
  });
});
