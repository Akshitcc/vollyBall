/**
 * Test harness: a real MySQL database (TEST_DATABASE_URL, must end in `_test`
 * because every run drops all its tables), fake identity verifier, in-memory
 * push sender and a temporary photo directory.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp } from '../src/app';
import { StaticTokenVerifier, type Identity } from '../src/auth/verifier';
import type { Services } from '../src/context';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate } from '../src/db/migrate';
import { LiveBus } from '../src/live/bus';
import { attachLive } from '../src/live/ws';
import { MemoryPushSender } from '../src/push/pushSender';
import { LocalDiskStorage } from '../src/storage/photoStorage';
import { Logger, setLogger } from '../src/ops/logger';

setLogger(new Logger('silent')); // launch prep: request logs off in tests
import { INDOOR_RULES } from '../../src/core/rules';
import { TERMS_VERSION } from '../../src/core/terms';

/** 1.3.0: the admin of the test server (ADMIN_UIDS allow-list). */
export const ADMIN: Identity = { uid: 'admin1', phone: null };

/**
 * 1.3.0: the existing suites run as people who already accepted the current T&C (the gate itself is
 * tested in antifraud.test.ts with fresh identities). Written straight to the table, as a fixture.
 */
export async function acceptTermsFor(db: Db, uids: readonly string[]) {
  if (!uids.length) return;
  await db('terms_acceptances').insert(uids.map((u) => ({ user_id: u, version: TERMS_VERSION, accepted_at: new Date() }))).onConflict('user_id').merge();
}
const FIXTURE_UIDS = () => [...Object.values(PEOPLE).map((p) => p.uid), 'nophone', ADMIN.uid];

export const PEOPLE = {
  cap: { uid: 'cap', phone: '+919000000001', name: 'Captain Cool' },
  bob: { uid: 'bob', phone: '+919000000002', name: 'Bob Builder' },
  eve: { uid: 'eve', phone: '+919000000003', name: 'Eve Outsider' },
  dan: { uid: 'dan', phone: '+919000000004', name: 'Dan Defender' },
  aarav: { uid: 'aarav', phone: '+919000000005', name: 'Aarav Sharma' },
  // the rest of the two 6-player squads (MIN_PLAYERS)
  a3: { uid: 'a3', phone: '+919000000006', name: 'Arjun Mehta' },
  a4: { uid: 'a4', phone: '+919000000007', name: 'Kabir Singh' },
  a5: { uid: 'a5', phone: '+919000000008', name: 'Ishaan Rao' },
  a6: { uid: 'a6', phone: '+919000000009', name: 'Vihaan Das' },
  b3: { uid: 'b3', phone: '+919000000010', name: 'Rohan Gupta' },
  b4: { uid: 'b4', phone: '+919000000011', name: 'Dev Patel' },
  b5: { uid: 'b5', phone: '+919000000012', name: 'Yash Verma' },
  b6: { uid: 'b6', phone: '+919000000013', name: 'Neel Joshi' },
  zed: { uid: 'zed', phone: '+919000000014', name: 'Zed Extra' },
} as const;
/** Team A = cap, bob, a3..a6; team B = aarav, dan, b3..b6 (6 each). */
export const SQUAD_A = ['cap', 'bob', 'a3', 'a4', 'a5', 'a6'] as const;
export const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'] as const;
/** Everyone the match tests need: both squads plus eve (an outsider). */
export const EVERYONE = [...SQUAD_A, ...SQUAD_B, 'eve'] as const;
export type Who = keyof typeof PEOPLE;

const BASE = 'http://api.test';

export interface Harness {
  s: Services;
  db: Db;
  push: MemoryPushSender;
  api: ReturnType<typeof request>;
  as: (who: Who | 'nophone' | Identity) => { get: (p: string) => request.Test; post: (p: string) => request.Test; put: (p: string) => request.Test; patch: (p: string) => request.Test; del: (p: string) => request.Test };
  server: http.Server;
  port: number;
  close: () => Promise<void>;
  reset: () => Promise<void>;
  flushPush: () => Promise<void>;
}

export function testDbUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Set TEST_DATABASE_URL, e.g. mysql://USER:PASSWORD@127.0.0.1:3306/volleylive_test (see server/README.md)');
  if (!new URL(url).pathname.replace(/^\//, '').endsWith('_test')) throw new Error('TEST_DATABASE_URL must point at a database whose name ends in _test (tests drop all tables)');
  return url;
}

export async function startHarness(): Promise<Harness> {
  const db = createDb(testDbUrl(), { max: 5 });
  await dropAll(db);
  await migrate(db);
  await acceptTermsFor(db, FIXTURE_UIDS());
  const tokens: Record<string, Identity> = {};
  for (const [k, p] of Object.entries(PEOPLE)) tokens[`t-${k}`] = { uid: p.uid, phone: p.phone };
  tokens['t-nophone'] = { uid: 'nophone', phone: null };
  const push = new MemoryPushSender();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-photos-'));
  const s: Services = {
    db,
    verifier: new StaticTokenVerifier(tokens),
    storage: new LocalDiskStorage(dir, BASE, 'test-secret-'.repeat(4), 3600),
    push,
    bus: new LiveBus(),
    publicBaseUrl: BASE,
    corsOrigins: ['http://localhost:8081'],
    pending: new Set(),
    adminUids: new Set([ADMIN.uid]),
  };
  const app = createApp(s);
  const server = http.createServer(app);
  const live = attachLive(server, s.bus, s.verifier);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const api = request(server);
  const tokenFor = (who: Who | 'nophone' | Identity) => {
    if (typeof who === 'string') return `t-${who}`;
    const t = `t-custom-${who.uid}`;
    tokens[t] = who;
    return t;
  };
  const as: Harness['as'] = (who) => {
    const auth = `Bearer ${tokenFor(who)}`;
    return {
      get: (p) => api.get(p).set('Authorization', auth),
      post: (p) => api.post(p).set('Authorization', auth),
      put: (p) => api.put(p).set('Authorization', auth),
      patch: (p) => api.patch(p).set('Authorization', auth),
      del: (p) => api.delete(p).set('Authorization', auth),
    };
  };
  return {
    s,
    db,
    push,
    api,
    as,
    server,
    port,
    reset: async () => {
      await dropAll(db);
      await migrate(db);
      await acceptTermsFor(db, FIXTURE_UIDS());
      push.sent.length = 0;
      s.rateLimiter?.reset(); // 1.3.1: each test starts with full rate-limit buckets
    },
    flushPush: async () => {
      await Promise.all([...(s.pending ?? [])]);
    },
    close: async () => {
      live.close();
      await new Promise<void>((r) => server.close(() => r()));
      await db.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Creates profiles for the given people. */
export async function register(h: Harness, ...who: Who[]) {
  for (const w of who) {
    const p = PEOPLE[w];
    const r = await h.as(w).put(`/api/users/${p.uid}`).send({ name: p.name, phone: p.phone, position: 'any' });
    if (r.status !== 200) throw new Error(`register ${w}: ${r.status} ${JSON.stringify(r.body)}`);
  }
}

export const team = (name: string, players: { id: string; name: string }[], teamId: string | null = null) => ({ teamId, name, color: '#E53935', players });
export const playersOf = (ids: readonly string[]) => ids.map((id) => ({ id, name: (PEOPLE as Record<string, { name: string }>)[id]?.name ?? id }));

/**
 * A registered team: the captain creates it and every other member joins by invite + accept
 * (one invite at a time, as the app does).
 */
export async function makeTeam(h: Harness, captain: Who, members: readonly Who[], name = `${PEOPLE[captain].name}'s team`) {
  const r = await h.as(captain).post('/api/teams').send({ name, color: '#E53935', captainId: captain, memberIds: [captain], subIds: [], pendingPhones: [] });
  if (r.status !== 201) throw new Error(`team: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.id as string;
  for (const m of members.filter((x) => x !== captain)) {
    const inv = await h.as(captain).patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE[m].phone] });
    if (inv.status !== 200) throw new Error(`invite ${m}: ${inv.status} ${JSON.stringify(inv.body)}`);
    const acc = await h.as(m).post(`/api/teams/${id}/accept`);
    if (acc.status !== 200) throw new Error(`accept ${m}: ${acc.status} ${JSON.stringify(acc.body)}`);
  }
  return id;
}

/** A quick live match scored by `cap`: two 6-player sides built from registered users (SQUAD_A v SQUAD_B). */
export function newMatchBody(over: Record<string, unknown> = {}) {
  return {
    teamA: team('QA Spikers', playersOf(SQUAD_A)),
    teamB: team('Delhi Smashers', playersOf(SQUAD_B)),
    rules: { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 5, winBy: 1 },
    firstServe: 'A',
    events: [],
    status: 'live',
    createdBy: 'cap',
    scorerId: 'cap',
    participantIds: [...SQUAD_A, ...SQUAD_B],
    // 1.3.0: the creator names both captains of sides built by number (core/antifraud.ts).
    captains: { A: 'cap', B: 'aarav' },
    location: { name: 'Lodhi Garden', lat: 28.59, lng: 77.22 },
    startedAt: Date.now(),
    interestedIds: [],
    ...over,
  };
}

export async function createMatch(h: Harness, over: Record<string, unknown> = {}) {
  const r = await h.as('cap').post('/api/matches').send(newMatchBody(over));
  if (r.status !== 201) throw new Error(`create match: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}

export const pt = (side: 'A' | 'B', at: number, playerId?: string, kind?: string) => ({ type: 'point', side, at, ...(playerId ? { playerId } : {}), ...(kind ? { kind } : {}) });
