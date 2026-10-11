import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, SQUAD_A, SQUAD_B, createMatch, makeTeam, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6d10000000049454e44ae426082', 'hex');
const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: 8, decidingSwitchAt: null };
const filePath = (url: string) => new URL(url).pathname + new URL(url).search;

describe('photos (rules: matches/{id}/photos + storage.rules)', () => {
  it('participants upload images < 10 MB; served through expiring signed URLs; uploader deletes', async () => {
    const id = await createMatch(h);
    const up = (who: 'cap' | 'eve', type: string, body: Buffer) => h.as(who).post(`/api/matches/${id}/photos`).set('Content-Type', type).send(body);
    assert.equal((await up('eve', 'image/png', PNG)).status, 403); // not a player
    assert.equal((await up('cap', 'text/html', Buffer.from('<script>'))).status, 403);
    assert.equal((await up('cap', 'image/png', Buffer.alloc(10 * 1024 * 1024))).status, 413);
    const r = await up('cap', 'image/png', PNG);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.url, /^http:\/\/api\.test\/files\/.+\?exp=\d+&sig=[\w-]+$/);
    const file = await h.api.get(filePath(r.body.url));
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    assert.ok(Buffer.compare(file.body, PNG) === 0);
    assert.equal((await h.api.get(filePath(r.body.url).replace(/sig=[\w-]/, "sig="))).status, 403);
    assert.equal((await h.api.get(filePath(r.body.url).replace(/exp=\d+/, 'exp=1'))).status, 403);
    assert.equal((await h.api.get('/files/..%2F..%2Fetc%2Fpasswd?exp=9999999999&sig=00')).status, 403);
    const list = (await h.as('eve').get(`/api/matches/${id}/photos`)).body;
    assert.equal(list.length, 1);
    assert.equal((await h.as('eve').del(`/api/matches/${id}/photos/${list[0].id}`)).status, 403);
    assert.equal((await h.as('cap').del(`/api/matches/${id}/photos/${list[0].id}`)).status, 204);
    assert.equal((await h.api.get(filePath(r.body.url))).status, 404);
  });

  it('avatars: only your own', async () => {
    assert.equal((await h.as('bob').post('/api/users/cap/avatar').set('Content-Type', 'image/png').send(PNG)).status, 403);
    const r = await h.as('cap').post('/api/users/cap/avatar').set('Content-Type', 'image/png').send(PNG);
    assert.equal(r.status, 201);
    assert.equal((await h.api.get(filePath(r.body.url))).status, 200);
  });
});

/** Two registered 6-player teams: QA Spikers (captain cap) and Delhi Smashers (captain dan). */
async function twoTeams() {
  return { a: await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers'), b: await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers') };
}

describe('challenges (rules: challenges/{id})', () => {
  it('captain challenges as themself; names come from the DB; challenged captain is notified', async () => {
    const { a, b } = await twoTeams();
    await h.as('dan').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[dan]' });
    const body = { fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 86400000, location: place, rules };
    assert.equal((await h.as('bob').post('/api/challenges').send({ ...body, fromCaptainId: 'bob' })).status, 403);
    assert.equal((await h.as('cap').post('/api/challenges').send({ ...body, toCaptainId: 'aarav' })).status, 403);
    assert.equal((await h.as('cap').post('/api/challenges').send({ ...body, status: 'accepted' })).status, 403);
    // QA G19 / N28: a name that isn't the team's name is refused; names are taken from the DB.
    const spoof = await h.as('cap').post('/api/challenges').send({ ...body, fromTeamName: 'Admin Team' });
    assert.equal(spoof.status, 400);
    assert.equal(spoof.body.error, 'team_name_mismatch');
    const r = await h.as('cap').post('/api/challenges').send(body);
    assert.equal(r.status, 201);
    const [c] = (await h.as('eve').get(`/api/challenges?teams=${b}`)).body;
    assert.deepEqual([c.fromTeamName, c.toTeamName, c.status], ['QA Spikers', 'Delhi Smashers', 'pending']);
    await h.flushPush();
    assert.equal(h.push.sent[0].to, 'ExponentPushToken[dan]');
  });

  it('both teams need at least 6 members to challenge (a captain alone cannot)', async () => {
    const { a } = await twoTeams();
    const solo = (await h.as('eve').post('/api/teams').send({ name: 'Solo', color: '#111111', captainId: 'eve', memberIds: ['eve'], subIds: [], pendingPhones: [] })).body.id;
    const r = await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: solo, toCaptainId: 'eve', when: Date.now(), location: place, rules });
    assert.equal(r.status, 403);
    assert.match(r.body.message, /A team needs at least 6 players to play \[challenges\.create\.teamSize\]/);
  });

  it('cannot accept after a team drops below 6 members', async () => {
    const { a, b } = await twoTeams();
    const id = (await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now(), location: place, rules })).body.id;
    assert.equal((await h.as('b6').post(`/api/teams/${b}/leave`)).status, 200);
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'accepted' })).status, 403);
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 200);
  });

  it('only the challenged captain answers; only the challenger cancels; never delete', async () => {
    const { a, b } = await twoTeams();
    await h.as('cap').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[cap]' });
    const id = (await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now(), location: place, rules })).body.id;
    assert.equal((await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'accepted' })).status, 403);
    assert.equal((await h.as('eve').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 403);
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'cancelled' })).status, 403);
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'accepted', matchId: 'nope' })).status, 400);
    h.push.sent.length = 0;
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'accepted' })).body.status, 'accepted');
    await h.flushPush();
    assert.equal(h.push.sent.length, 1);
    assert.equal((await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'cancelled' })).status, 403); // no longer pending
    assert.equal((await h.as('cap').del(`/api/challenges/${id}`)).status, 403);
  });
});

describe('tournaments (rules: tournaments/{id})', () => {
  let t1 = '';
  let t2 = '';
  beforeEach(async () => {
    ({ a: t1, b: t2 } = await twoTeams());
  });
  const body = () => ({
    name: 'Delhi Open', organizerId: 'cap', format: 'knockout', rules, startDate: Date.now(), endDate: Date.now() + 86400000, location: place, status: 'registration',
    teams: [{ id: t1, name: 'One', color: '#111111' }, { id: t2, name: 'Two', color: '#222222' }],
    fixtures: [{ id: 'f1', round: 1, index: 0, homeId: t1, awayId: t2 }],
  });
  it('organiser only; references are validated', async () => {
    assert.equal((await h.as('bob').post('/api/tournaments').send(body())).status, 403);
    assert.equal((await h.as('cap').post('/api/tournaments').send({ ...body(), fixtures: [{ id: 'f1', round: 1, index: 0, homeId: 't9', awayId: t2 }] })).status, 400);
    const id = (await h.as('cap').post('/api/tournaments').send(body())).body.id;
    assert.equal((await h.as('bob').patch(`/api/tournaments/${id}`).send({ status: 'running' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/tournaments/${id}`).send({ organizerId: 'bob' })).status, 403);
    const m = await createMatch(h, { tournamentId: id, fixtureId: 'f1' });
    const fx = [{ id: 'f1', round: 1, index: 0, homeId: t1, awayId: t2, matchId: m }];
    const p = await h.as('cap').patch(`/api/tournaments/${id}`).send({ status: 'running', fixtures: fx });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.fixtures[0].matchId, m);
    assert.equal((await h.as('eve').get(`/api/matches?tournament=${id}`)).body.length, 1);
    assert.equal((await h.as('bob').del(`/api/tournaments/${id}`)).status, 403);
    assert.equal((await h.as('cap').del(`/api/tournaments/${id}`)).status, 204);
  });

  it('teams must be registered teams with at least 6 members (no name-only teams)', async () => {
    const ext = { ...body(), teams: [...body().teams, { id: 'ext_1', name: 'Typed Name FC', color: '#333333' }] };
    const r = await h.as('cap').post('/api/tournaments').send(ext);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Tournament teams must be registered teams/);
    const solo = (await h.as('eve').post('/api/teams').send({ name: 'Solo', color: '#111111', captainId: 'eve', memberIds: ['eve'], subIds: [], pendingPhones: [] })).body.id;
    const small = await h.as('cap').post('/api/tournaments').send({ ...body(), teams: [...body().teams, { id: solo, name: 'Solo', color: '#333333' }] });
    assert.equal(small.status, 400);
    assert.match(small.body.message, /A team needs at least 6 players to play/);
    // a team that is in a tournament can't be deleted (tournament_teams.team_id is required)
    assert.equal((await h.as('cap').post('/api/tournaments').send(body())).status, 201);
    assert.equal((await h.as('cap').del(`/api/teams/${t1}`)).status, 409);
  });
});

describe('courts (rules: courts/{id})', () => {
  it('anyone signed in adds as themself; only the adder edits or deletes', async () => {
    const c = { name: 'Lodhi Garden', location: place, surface: 'grass', addedBy: 'bob' };
    assert.equal((await h.as('cap').post('/api/courts').send(c)).status, 403);
    const id = (await h.as('bob').post('/api/courts').send(c)).body.id;
    assert.equal((await h.as('cap').get('/api/courts')).body.length, 1);
    assert.equal((await h.as('cap').patch(`/api/courts/${id}`).send({ name: 'Mine' })).status, 403);
    assert.equal((await h.as('bob').patch(`/api/courts/${id}`).send({ addedBy: 'cap' })).status, 403);
    assert.equal((await h.as('bob').patch(`/api/courts/${id}`).send({ surface: 'outdoor' })).body.surface, 'outdoor');
    assert.equal((await h.as('cap').del(`/api/courts/${id}`)).status, 403);
    assert.equal((await h.as('bob').del(`/api/courts/${id}`)).status, 204);
  });
});
