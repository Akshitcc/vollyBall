/**
 * Input validation (QA input-validation audit G8-G19, B3; fix-retest N4). The same shared checks
 * (src/core/limits.ts, text.ts, dates.ts, photos.ts, validate.ts) run in the app and firestore.rules.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { acceptTermsFor, EVERYONE, SQUAD_A, SQUAD_B, createMatch, makeTeam, newMatchBody, register, startHarness, team, playersOf, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const DAY = 86_400_000;
const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: 8 };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6d10000000049454e44ae426082', 'hex');
const code = (r: { status: number; body: { error?: string } }, status: number, c: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  assert.equal(r.body.error, c, JSON.stringify(r.body));
};
const profile = (who: 'bob', over: Record<string, unknown>) => h.as(who).put('/api/users/bob').send({ name: 'Bob Builder', phone: '+919000000002', position: 'any', ...over });

describe('names and text (G14, G15/G17, B3)', () => {
  it('profile names: zero-width only, control characters and bidi overrides are refused; NFC is stored', async () => {
    code(await profile('bob', { name: '\u200b\u200b' }), 400, 'text_empty');
    code(await profile('bob', { name: '   ' }), 400, 'text_empty');
    code(await profile('bob', { name: '😀😀' }), 400, 'text_empty'); // needs a letter or digit
    code(await profile('bob', { name: 'a\u0000b' }), 400, 'text_control');
    code(await profile('bob', { name: 'Bob\nBuilder' }), 400, 'text_control');
    code(await profile('bob', { name: '\u202eevil' }), 400, 'text_bidi');
    code(await profile('bob', { name: 'B' }), 400, 'text_too_short');
    const long = await profile('bob', { name: 'x'.repeat(61) });
    code(long, 400, 'text_too_long');
    assert.equal(long.body.max, 60);
    assert.equal(long.body.field, 'name');
    assert.equal((await profile('bob', { name: 'é'.normalize('NFD').repeat(40) })).status, 200); // 40 letters after NFC
    const r = await profile('bob', { name: ' \u200bराहुल शर्मा\u200b ' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'राहुल शर्मा');
  });

  it('B3: a city of only spaces is saved as empty, never as whitespace', async () => {
    const r = await profile('bob', { city: '     ' });
    assert.equal(r.status, 200);
    assert.ok(!r.body.city, JSON.stringify(r.body));
    assert.equal((await profile('bob', { city: '  Delhi ' })).body.city, 'Delhi');
    code(await profile('bob', { city: 'c'.repeat(81) }), 400, 'text_too_long');
  });

  it('one table of limits: side name 40, team 2..40, tournament 3..80, court 2..80, title 120, message 500', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ teamA: team('n'.repeat(41), playersOf(SQUAD_A)) })), 400, 'text_too_long');
    assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ teamA: team('n'.repeat(40), playersOf(SQUAD_A)) }))).status, 201);
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ title: 'm'.repeat(121) })), 400, 'text_too_long');
    const blankTitle = await h.as('cap').post('/api/matches').send(newMatchBody({ title: '   ' }));
    assert.equal(blankTitle.status, 201);
    code(await h.as('cap').post('/api/teams').send({ name: '\u200b', color: '#E53935', captainId: 'cap', memberIds: ['cap'], subIds: [], pendingPhones: [] }), 400, 'text_empty');
    code(await h.as('cap').post('/api/courts').send({ name: '   ', location: place, surface: 'outdoor', addedBy: 'cap' }), 400, 'text_empty');
    code(await h.as('cap').post('/api/courts').send({ name: 'Court', location: { ...place, name: 'p'.repeat(161) }, surface: 'outdoor', addedBy: 'cap' }), 400, 'text_too_long');
  });
});

describe('scores and rules (G12, G13)', () => {
  it('rules go through the app\'s validateRules (cross-field too)', async () => {
    for (const bad of [{ pointsPerSet: 0 }, { bestOf: 2 }, { winBy: 0 }, { pointsPerSet: 25, pointCap: 5 }, { decidingSetPoints: 15, decidingSwitchAt: 50 }, { pointsPerSet: 1.5 }])
      assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ rules: { ...rules, preset: 'custom', ...bad } }))).status, 400, JSON.stringify(bad));
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ rules: { ...rules, preset: 'custom', decidingSwitchAt: 50 } })), 400, 'rules_invalid');
  });

  it('events: side A/B, not negative, not far in the future, at most 2000; finish not before start', async () => {
    const id = await createMatch(h);
    code(await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [{ type: 'point', side: 'A', at: Date.now() + 3 * DAY }], status: 'live' }), 400, 'events_invalid');
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [{ type: 'point', side: 'C', at: Date.now() }], status: 'live' })).status, 400);
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [{ type: 'point', side: 'A', at: -5 }], status: 'live' })).status, 400);
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'scheduled', startedAt: Date.now(), finishedAt: Date.now() - DAY })), 400, 'end_before_start');
    // 1.2.1 (NB-R3): the server sets finishedAt itself; a client value (even before the start) is ignored
    // (1.3.0: a client finishedAt is refused outright, 400 server_time)
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned', finishedAt: Date.now() - DAY }), 400, 'server_time');
    const ab = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.equal(ab.status, 200);
    assert.ok(ab.body.finishedAt > Date.now() - 60_000);
  });
});

describe('times (G8, G9)', () => {
  it('a scheduled match, challenge or tournament start can\'t already be over (15 min grace)', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'scheduled', startedAt: null, scheduledAt: Date.now() - 7 * DAY })), 400, 'time_in_past');
    assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'scheduled', startedAt: null, scheduledAt: Date.now() - 5 * 60_000 }))).status, 201);
    const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
    const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
    const chal = (when: number) => h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when, location: place, rules });
    code(await chal(Date.now() - DAY), 400, 'time_in_past');
    code(await chal(0), 400, 'time_in_past');
    assert.equal((await chal(Date.now() + 60_000)).status, 201);
    const teams = [{ id: a, name: 'QA Spikers', color: '#E53935' }, { id: b, name: 'Delhi Smashers', color: '#2B2B2B' }];
    const tour = (o: Record<string, unknown>) => h.as('cap').post('/api/tournaments').send({ name: 'Probe Cup', organizerId: 'cap', format: 'knockout', rules, startDate: Date.now() + DAY, endDate: Date.now() + 2 * DAY, location: place, teams, fixtures: [], status: 'running', ...o });
    code(await tour({ startDate: Date.now() + 5 * DAY, endDate: Date.now() + DAY }), 400, 'end_before_start');
    code(await tour({ startDate: 1577836800000, endDate: 1577923200000 }), 400, 'time_in_past');
    code(await tour({ teams: [teams[0]] }), 400, 'need_two_teams');
    code(await tour({ teams: [teams[0], teams[0]] }), 400, 'duplicate_teams');
    code(await tour({ name: 'X' }), 400, 'text_too_short');
    const ok = await tour({});
    assert.equal(ok.status, 201);
    // an unchanged (even past) start stays editable; only a new start date is checked
    await h.db('tournaments').where({ id: ok.body.id }).update({ start_date: new Date(Date.now() - 3 * DAY), end_date: new Date(Date.now() - DAY) });
    assert.equal((await h.as('cap').patch(`/api/tournaments/${ok.body.id}`).send({ status: 'finished' })).status, 200);
  });
});

describe('challenge names (G19)', () => {
  it('names must match the team documents', async () => {
    const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
    const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
    const body = { fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + DAY, location: place, rules };
    code(await h.as('cap').post('/api/challenges').send({ ...body, toTeamName: 'Official VolleyLive' }), 400, 'team_name_mismatch');
    assert.equal((await h.as('cap').post('/api/challenges').send({ ...body, fromTeamName: 'QA Spikers', toTeamName: 'Delhi Smashers' })).status, 201);
  });
});

describe('photos (G3, G11)', () => {
  it('magic bytes decide, not the declared type; 0 bytes and >= 10 MB refused', async () => {
    const id = await createMatch(h);
    const up = (type: string, body: Buffer) => h.as('cap').post(`/api/matches/${id}/photos`).set('Content-Type', type).send(body);
    code(await up('image/png', Buffer.from('<html><script>alert(1)</script></html>')), 400, 'photo_type');
    code(await up('image/jpeg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 400, 'photo_type');
    assert.equal((await up('image/svg+xml', Buffer.from('<svg/>'))).status, 403);
    code(await up('image/png', Buffer.alloc(10 * 1024 * 1024 + 1)), 413, 'photo_too_large');
    // the stored type is the sniffed one: a PNG declared as JPEG is served as image/png
    const r = await up('image/jpeg', PNG);
    assert.equal(r.status, 201);
    const f = await h.api.get(new URL(r.body.url).pathname + new URL(r.body.url).search);
    assert.equal(f.headers['content-type'], 'image/png');
    assert.match(String(f.headers['content-security-policy']), /default-src 'none'/);
  });

  it('profile photo URL must be one of our own avatar uploads', async () => {
    code(await profile('bob', { photoURL: 'javascript:alert(1)' }), 400, 'photo_url');
    code(await profile('bob', { photoURL: 'https://evil.example/x.png' }), 400, 'photo_url');
    const capAvatar = await h.as('cap').post('/api/users/cap/avatar').set('Content-Type', 'image/png').send(PNG);
    code(await profile('bob', { photoURL: capAvatar.body.url }), 400, 'photo_url'); // someone else's
    const mine = await h.as('bob').post('/api/users/bob/avatar').set('Content-Type', 'image/png').send(PNG);
    assert.equal((await profile('bob', { photoURL: mine.body.url })).status, 200);
    assert.equal((await profile('bob', { photoURL: null })).status, 200);
  });
});

describe('accounts from before build 216 with a non-Indian number (fix-retest N4)', () => {
  const LEGACY = { uid: 'legacy', phone: '+16505551234' };
  beforeEach(async () => {
    // as written before 216 (no migration rewrites it)
    await h.db('users').insert({ id: 'legacy', name: 'Old Timer', phone: LEGACY.phone, position: 'any', created_at: new Date(), updated_at: new Date() });
  });
  it('saving the profile with the number unchanged works; changing to another bad number does not', async () => {
    await acceptTermsFor(h.db, ['legacy', 'newbie']);
    const r = await h.as(LEGACY).put('/api/users/legacy').send({ name: 'Old Timer Renamed', phone: LEGACY.phone, position: 'setter' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, 'Old Timer Renamed');
    assert.equal((await h.db('users').where({ id: 'legacy' }).first()).phone, LEGACY.phone); // untouched
    const other = { uid: 'newbie', phone: '+447911123456' };
    code(await h.as(other).put('/api/users/newbie').send({ name: 'New Person', phone: other.phone }), 400, 'invalid_phone');
  });
  it('the invite list answers with a clear invalid_phone state (the app shows "update your number")', async () => {
    code(await h.as(LEGACY).get(`/api/teams?invitedPhone=${encodeURIComponent(LEGACY.phone)}`), 400, 'invalid_phone');
  });
});

describe('team search (G16 server side)', () => {
  it('caps the query at 40 characters like the search box', async () => {
    const ok = await h.as('bob').get(`/api/teams?q=${encodeURIComponent('x'.repeat(40))}`);
    assert.equal(ok.status, 200);
    code(await h.as('bob').get(`/api/teams?q=${encodeURIComponent('x'.repeat(41))}`), 400, 'text_too_long');
  });
});
