/**
 * 1.4.3 demo backend + core guard: V142-1/V142-3 (once the winning rally exists nothing about the match changes –
 * every frozen field is tried), V142-7 (no abandon / void by the scorer after the end).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match } from '../../core/types';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';
import { FINISHED_MATCH_FROZEN, FINISHED_MATCH_WRITABLE, MATCH_FIELDS, guardUpdate, finishedFreezeProblem } from '../../core/matchGuards';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
async function signedIn(phone = '+919000000010') {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  made.push(b);
  const otp = b.sendOtp(phone);
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
  return b;
}
const dbOf = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Match> } }).db;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));
const codeOfSync = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

/** A different value of the same shape for every Match field. */
function mutate(k: string, v: unknown): unknown {
  switch (k) {
    case 'rules': return { ...(v as object), pointsPerSet: 15 };
    case 'summary': { const s = v as Match['summary']; return { ...s, winner: s?.winner === 'A' ? 'B' : 'A', setsA: 0, setsB: 2 }; }
    case 'status': return 'live';
    case 'firstServe': return v === 'A' ? 'B' : 'A';
    case 'teamA': case 'teamB': return { ...(v as object), name: 'Renamed' };
    case 'participantIds': case 'interestedIds': return [...((v as string[]) ?? []), 'bob'];
    case 'lineups': return { A: ['x1'], B: ['x2'] };
    case 'captains': return { A: 'bob', B: 'eve' };
    case 'stream': return { url: 'https://youtu.be/abc', platform: 'youtube' };
    case 'location': return { ...((v as object) ?? {}), name: 'Elsewhere' };
    case 'teamSizeMode': return v === 'fixed' ? 'flexible' : 'fixed';
    default:
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'string') return `${v}-x`;
      return `changed-${k}`;
  }
}
const OK_CODES = ['match_finished', 'server_time', 'server_field', 'potm_use_endpoint', 'match_terminal'];

async function finishedDemo() {
  const b = await signedIn();
  const m0 = dbOf(b).matches.match_live;
  let ev = [...m0.events];
  let t = Date.now();
  while (!computeState(m0.rules, ev, m0.firstServe).finished) ev = addPoint(m0.rules, ev, 'A', { at: ++t });
  // the client still says "live" (an older app) – the demo makes it finished, like the API
  await b.saveMatchProgress(m0.id, { events: ev, summary: summarize(computeState(m0.rules, ev, m0.firstServe)), status: 'live' });
  return { b, ev, m: dbOf(b).matches.match_live };
}

describe('1.4.3: the frozen-field list', () => {
  it('covers every Match field: writable = events (credit one of the last 3), POTM, verification/confirmation, stamps', () => {
    expect([...FINISHED_MATCH_FROZEN, ...FINISHED_MATCH_WRITABLE.filter((k) => (MATCH_FIELDS as readonly string[]).includes(k))].sort()).toEqual([...MATCH_FIELDS].sort());
    expect(FINISHED_MATCH_FROZEN).toEqual(expect.arrayContaining(['rules', 'summary', 'status', 'firstServe', 'teamA', 'teamB', 'lineups', 'captains', 'scorerId', 'interestedIds', 'title', 'location', 'scheduledAt', 'stream', 'teamSizeMode', 'participantIds']));
  });
});

describe('V142-3: demo – a finished match (no POTM yet) refuses every frozen field', () => {
  it('each of FINISHED_MATCH_FROZEN, alone, is refused and nothing is stored', async () => {
    const { b, m } = await finishedDemo();
    expect(m.status).toBe('finished');
    expect(m.playerOfMatchId ?? null).toBeNull();
    const before = JSON.stringify(m);
    const results: [string, string | null][] = [];
    for (const k of FINISHED_MATCH_FROZEN) {
      const patch = { [k]: mutate(k, (m as unknown as Record<string, unknown>)[k]) } as Partial<Match>;
      results.push([k, await codeOf(b.updateMatch(m.id, patch))]);
    }
    for (const [k, c] of results) expect([k, OK_CODES.includes(c ?? '')]).toEqual([k, true]);
    expect(JSON.stringify(dbOf(b).matches.match_live)).toBe(before);
  });
  it('V142-1: rules changes (points, deciding set, best of, win by, cap) → match_finished', async () => {
    const { b, m } = await finishedDemo();
    const R = m.rules as unknown as Record<string, number | undefined>;
    for (const r of [{ pointsPerSet: (R.pointsPerSet ?? 25) - 4 }, { decidingSetPoints: (R.decidingSetPoints ?? 15) + 2 }, { bestOf: R.bestOf === 5 ? 3 : 5 }, { winBy: R.winBy === 1 ? 2 : 1 }, { pointCap: (R.pointCap ?? 30) + 1 }])
      expect([r, await codeOf(b.updateMatch(m.id, { rules: { ...m.rules, ...r } as Match["rules"] }))]).toEqual([r, "match_finished"]);
    expect(dbOf(b).matches.match_live.rules).toEqual(m.rules);
  });
  it('the core guard says the same (guardUpdate, used by the demo and the Firebase client)', async () => {
    const { m } = await finishedDemo();
    for (const k of FINISHED_MATCH_FROZEN) {
      const c = codeOfSync(() => guardUpdate(m, { [k]: mutate(k, (m as unknown as Record<string, unknown>)[k]) } as Partial<Match>));
      expect([k, OK_CODES.includes(c ?? '')]).toEqual([k, true]);
    }
    // unchanged values (a client re-sending the doc) are no change
    expect(codeOfSync(() => guardUpdate(m, { title: m.title, rules: m.rules }))).toBeNull();
  });
});

describe('V142-7: abandon / void by the scorer after the winning rally', () => {
  it('demo: status abandoned → match_finished; the result stays', async () => {
    const { b, m } = await finishedDemo();
    expect(await codeOf(b.updateMatch(m.id, { status: 'abandoned' }))).toBe('match_finished');
    expect(await codeOf(b.updateMatch(m.id, { status: 'scheduled' }))).toBe('match_finished');
    expect(dbOf(b).matches.match_live.status).toBe('finished');
    expect(dbOf(b).matches.match_live.summary?.winner).toBe('A');
  });
  it('core: also a "live" doc whose events already have a winner (an older client) can\'t be abandoned or edited', async () => {
    const { m } = await finishedDemo();
    const liveButWon = { ...m, status: 'live' as const };
    expect(finishedFreezeProblem(liveButWon, ['status'], m.events, 'abandoned')).toBe('match_finished');
    expect(finishedFreezeProblem(liveButWon, ['rules'], m.events, 'live')).toBe('match_finished');
    expect(finishedFreezeProblem(liveButWon, ['status'], m.events, 'finished')).toBeNull();
    const notWon = { ...m, status: 'live' as const, events: m.events.slice(0, -1) };
    expect(finishedFreezeProblem(notWon, ['status'], notWon.events, 'abandoned')).toBeNull();
  });
  it('POTM and crediting one of the last 3 rallies still work after the end', async () => {
    const { b, ev, m } = await finishedDemo();
    const last = ev[ev.length - 1] as Extract<MatchEvent, { type: 'point' }>;
    const res: (string | null)[] = [];
    for (const p of m.teamA.players) res.push(await codeOf(b.saveMatchProgress(m.id, { events: [...ev.slice(0, -1), { ...last, playerId: p.id }], summary: m.summary!, status: 'finished' })));
    expect(res).toContain(null);
    expect(res).not.toContain('match_finished');
    const credited = dbOf(b).matches.match_live;
    expect(credited.summary).toEqual(m.summary);
    expect(await codeOf(b.setPlayerOfMatch(m.id, m.teamA.players[0].id))).toBeNull();
  });
});
