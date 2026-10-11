import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { seedDemo } from '../src/db/seed';
import { createMatch, pt, register, startHarness, type Harness, EVERYONE } from './helpers';

let h: Harness;
before(async () => {
  h = await startHarness();
  await register(h, ...EVERYONE);
});
after(async () => h.close());

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/live`);
  const inbox: Record<string, unknown>[] = [];
  const waiters: [(m: Record<string, unknown>) => boolean, (m: Record<string, unknown>) => void][] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    inbox.push(m);
    for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m); }
  });
  const next = (pred: (m: Record<string, unknown>) => boolean, ms = 3000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) return resolve(hit);
      const t = setTimeout(() => reject(new Error('timeout waiting for WS message')), ms);
      waiters.push([pred, (m) => { clearTimeout(t); resolve(m); }]);
    });
  const send = (m: object) => ws.send(JSON.stringify(m));
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return { ws, next, send, open, closed };
}

describe('live scoreboard over WebSocket (/live)', () => {
  it('pushes the full match document to spectators after every rally, without the ingest URL', async () => {
    const id = await createMatch(h, { stream: { provider: 'rtmp', playbackUrl: 'https://example.invalid/p.m3u8', ingestUrl: 'rtmp://example.invalid/live/KEY_PLACEHOLDER', live: true } });
    const c = connect();
    await c.open;
    c.send({ type: 'auth', token: 't-eve' });
    assert.equal((await c.next((m) => m.type === 'ready')).uid, 'eve');
    c.send({ type: 'sub', topic: `match:${id}` });
    await new Promise((r) => setTimeout(r, 50));
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('B', 1, 'aarav', 'kill')] });
    const doc = await c.next((m) => m.type === 'doc' && m.topic === `match:${id}`);
    const data = doc.data as { summary: { currentB: number }; events: unknown[]; stream: { ingestUrl?: string }; rotation: { serving: string } };
    assert.equal(data.summary.currentB, 1);
    assert.equal(data.rotation.serving, 'B');
    assert.equal(data.stream.ingestUrl, undefined);
    // list topics only get an invalidate hint (their content depends on the viewer)
    c.send({ type: 'sub', topic: 'teams' });
    await new Promise((r) => setTimeout(r, 50));
    await h.as('cap').post('/api/teams').send({ name: 'WS Team', color: '#000000', captainId: 'cap', memberIds: ['cap'], subIds: [], pendingPhones: [] });
    const inv = await c.next((m) => m.topic === 'teams');
    assert.deepEqual([inv.type, inv.data], ['invalidate', undefined]);
    c.ws.close();
  });

  it('ignores subscriptions before auth and closes bad tokens with 4401', async () => {
    const c = connect();
    await c.open;
    c.send({ type: 'auth', token: 'wrong' });
    assert.equal(await c.closed, 4401);
  });
});

describe('demo seed', () => {
  it('loads the app demo data through the same rule-checked domain code', async () => {
    await h.reset();
    await seedDemo(h.s);
    const count = async (t: string) => Number((await h.db(t).count({ n: '*' }))[0].n);
    assert.equal(await count('users'), 24);
    assert.equal(await count('teams'), 4);
    // registered players only: every match player is a user, every tournament team a real team
    assert.equal(Number((await h.db('match_players').whereRaw('user_id <> player_key').count({ n: '*' }))[0].n), 0);
    assert.equal(await count('tournament_teams'), 4);
    const sides = await h.db('match_players').select('match_id', 'side').count({ n: '*' }).groupBy('match_id', 'side');
    assert.ok(sides.every((x: { n?: number | string }) => Number(x.n) >= 6 && Number(x.n) <= 12));
    assert.ok((await count('matches')) >= 3);
    assert.ok((await count('points')) > 0);
    assert.equal(await count('team_invites'), Number((await h.db('team_invites').where({ status: 'accepted' }).count({ n: '*' }))[0].n) + Number((await h.db('team_invites').where({ status: 'pending' }).count({ n: '*' }))[0].n));
    const live = await h.db('matches').where({ status: 'live' }).first('id');
    assert.ok(live);
    assert.ok((await h.db('points').where({ match_id: live.id }).whereNotNull('server_key')).length > 0);
  });
});
