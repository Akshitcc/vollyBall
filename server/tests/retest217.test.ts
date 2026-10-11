/**
 * Build-217 retest follow-ups on the API server (fixes-retest.md "Build 217"): legacy invites pass
 * through (#3), invisible fillers (#4), #RRGGBB colours (#5), UTF-16 lengths (#6), Unicode spaces
 * trimmed (#7), header-only images (#9), the 10-team tournament cap (#2).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, PEOPLE, SQUAD_A, SQUAD_B, createMatch, makeTeam, newMatchBody, register, startHarness, team, playersOf, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const code = (r: { status: number; body: { error?: string; message?: string } }, status: number, c?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (c) assert.equal(r.body.error, c);
};
const newTeam = (over: Record<string, unknown> = {}) => ({ name: 'Smashers', color: '#E53935', captainId: 'eve', memberIds: ['eve'], subIds: [], pendingPhones: [], ...over });
const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: 8 };

describe('#3 invite updates check only newly added numbers', () => {
  it('a legacy (non-Indian) invite passes through and can be removed; a new bad number is refused', async () => {
    const id = (await h.as('eve').post('/api/teams').send(newTeam())).body.id;
    await h.db('team_invites').insert({ team_id: id, phone: '+14155550100', invited_by: 'eve', status: 'pending', created_at: new Date() });
    const cur = (await h.as('eve').get(`/api/teams/${id}`)).body;
    assert.deepEqual(cur.pendingPhones, ['+14155550100']);
    code(await h.as('eve').patch(`/api/teams/${id}`).send({ pendingPhones: ['+14155550100', PEOPLE.bob.phone] }), 200);
    code(await h.as('eve').patch(`/api/teams/${id}`).send({ pendingPhones: ['+14155550100', PEOPLE.bob.phone, '+14155550101'] }), 400, 'invalid_phone');
    const removed = await h.as('eve').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone] });
    code(removed, 200);
    assert.deepEqual(removed.body.pendingPhones, [PEOPLE.bob.phone]);
  });
});

describe('#4/#6/#7 names: fillers, UTF-16 length, Unicode spaces', () => {
  it('filler-only names are empty; NBSP / line separators are trimmed; emoji count 2', async () => {
    for (const f of ['\u3164', '\uFFA0', '\u115F', '\u1160', '\u2800', '\u180E']) {
      code(await h.as('eve').post('/api/teams').send(newTeam({ name: f.repeat(4) })), 400, 'text_empty');
    }
    const t = await h.as('eve').post('/api/teams').send(newTeam({ name: '\u00A0Smashers\u2028' }));
    code(t, 201);
    assert.equal((await h.as('eve').get(`/api/teams/${t.body.id}`)).body.name, 'Smashers');
    code(await h.as('eve').post('/api/teams').send(newTeam({ name: 'A' + '😀'.repeat(20) })), 400, 'text_too_long'); // 41 units > 40
    code(await h.as('eve').post('/api/teams').send(newTeam({ name: 'A' + '😀'.repeat(19) })), 201); // 39 units
  });
});

describe('#5 colours are #RRGGBB everywhere', () => {
  it('teams, match sides and tournament teams', async () => {
    for (const color of ['#FFF', 'red', '#E53935AA', 'javascript:1']) code(await h.as('eve').post('/api/teams').send(newTeam({ color })), 400);
    const body = newMatchBody({ teamA: { ...team('A', playersOf(SQUAD_A)), color: '#E5393' } });
    code(await h.as('cap').post('/api/matches').send(body), 400);
    code(await h.as('cap').post('/api/matches').send(newMatchBody()), 201);
  });
});

describe('#9 header-only images', () => {
  it('a bare GIF header is refused; a real 1x1 GIF is stored', async () => {
    const id = await createMatch(h);
    const up = (body: Buffer) => h.as('cap').post(`/api/matches/${id}/photos`).set('Content-Type', 'image/gif').send(body);
    code(await up(Buffer.from('GIF89a')), 400, 'photo_truncated');
    code(await up(Buffer.from('474946383961010001008000', 'hex')), 400, 'photo_truncated');
    const gif = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex');
    code(await up(gif.subarray(0, gif.length - 1)), 400, 'photo_truncated');
    code(await up(gif), 201);
  });
});

describe('#2 tournaments: at most 10 teams (the rules can check all of them)', () => {
  it('11 teams are refused before any lookup', async () => {
    const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
    const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
    const teams = [{ id: a, name: 'One', color: '#111111' }, { id: b, name: 'Two', color: '#222222' }, ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `X${i}`, color: '#333333' }))];
    const body = { name: 'Delhi Open', organizerId: 'cap', format: 'league', rules, startDate: Date.now(), endDate: Date.now() + 86400000, location: place, status: 'registration', teams, fixtures: [] };
    code(await h.as('cap').post('/api/tournaments').send(body), 400);
    const two = { ...body, teams: teams.slice(0, 2).map((t, i) => (i ? { ...t, color: 'blue' } : t)) };
    code(await h.as('cap').post('/api/tournaments').send(two), 400); // colour
    code(await h.as('cap').post('/api/tournaments').send({ ...body, teams: teams.slice(0, 2) }), 201);
  });
});
