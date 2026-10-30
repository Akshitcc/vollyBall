/** 1.5.1 Tester's 1.5.0 retest – core: F150-2 (result states / team record), F150-4 (PII masks), F150-5 / F150-6 /
 * F150-7 and the known misses (intent parser + agent answers), the Ask lang nit. No network, no server. */
import { teamRecord } from '../teamRecord';
import { resultStatus } from '../resultStatus';
import { maskPii } from '../pii';
import { checkAskQuestion, scrubPii, buildIndex } from '../ask';
import { filterPii, runTool, type ToolHost } from '../ask/tools';
import { parseIntent } from '../ask/intents';
import { runAgent } from '../ask/agent';
import type { Match } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// ---- a real finished match (events with a winner) in any verification state ----
const { INDOOR_RULES } = require('../rules');
const { addPoint } = require('../scoring');
const QUICK = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null };
const side = (teamId: string) => ({ teamId, name: teamId, color: '#000000', players: [1, 2, 3].map((n) => ({ id: `${teamId}p${n}`, name: `${teamId}p${n}` })) });
const T0 = 2_000_000_000_000;
function fin(a: string, b: string, o: { v?: Record<string, unknown>; short?: boolean; potm?: boolean; id?: string } = {}): Match {
  let events: unknown[] = [];
  for (let i = 0; i < 3; i++) events = addPoint(QUICK, events, 'A', { at: 1 });
  return { id: o.id ?? `${a}-${b}`, status: 'finished', rules: QUICK, events, firstServe: 'A', teamA: side(a), teamB: side(b), createdBy: `${a}p1`, scorerId: `${a}p1`, captains: { A: `${a}p1`, B: `${b}p1` },
    verification: o.v ?? { status: 'confirmed', captain: 'confirmed', by: `${b}p1`, at: T0 }, playerOfMatchId: o.potm === false ? null : `${a}p1`,
    startedServerAt: T0 - (o.short ? 3 : 20) * 60_000, finishedServerAt: T0, finishedAt: T0, createdAt: T0 - 3_600_000, summary: { winner: 'A', setsA: 1, setsB: 0 }, title: '' } as unknown as Match;
}
const counted = fin('t1', 't2', { id: 'c' });
const awaiting = fin('t1', 't2', { id: 'a', v: { status: 'pending' } });
const tooShortConfirmed = fin('t1', 't2', { id: 'r', short: true }); // UI-A: the other captain confirmed, but < 10 min → admin review
const rejected = fin('t1', 't2', { id: 'd', v: { status: 'disputed', captain: 'rejected', by: 't2p1', at: T0, reason: 'wrong score' } });
const voided = fin('t1', 't2', { id: 'v', v: { status: 'voided', captain: 'confirmed', by: 't2p1', at: T0 } });
const approvedWaiting = fin('t1', 't2', { id: 'w', short: true, v: { status: 'approved' } });
const noPotm = fin('t1', 't2', { id: 'p', potm: false, v: { status: 'pending' } });

describe('F150-2: result states and the team record', () => {
  it('each result gets its real state', () => {
    expect([counted, awaiting, tooShortConfirmed, rejected, voided, approvedWaiting, noPotm].map(resultStatus)).toEqual(['counted', 'awaiting', 'review', 'disputed', 'voided', 'awaiting', 'potm']);
    expect(resultStatus({ ...counted, status: 'live' })).toBeNull();
  });
  it('teamRecord: only really-waiting results are "waiting for the other captain"; flagged → review; rejected → disputed; voided not counted', () => {
    const r = teamRecord('t1', [counted, awaiting, tooShortConfirmed, rejected, voided, approvedWaiting, noPotm]);
    expect(r).toEqual({ played: 1, won: 1, lost: 0, winRate: 100, awaiting: 2, awaitingSecond: 0, review: 1, reviewAwaiting: 0, disputed: 1, potm: 1, pending: 5 }); // 1.5.8: + awaitingSecond
    // Tester repros: (a) confirmed but too short, (b) rejected, (c) voided → none of them is "waiting for the other captain"
    expect(teamRecord('t2', [tooShortConfirmed]).awaiting).toBe(0);
    expect(teamRecord('t2', [rejected]).awaiting).toBe(0);
    expect(teamRecord('t2', [voided])).toMatchObject({ awaiting: 0, pending: 0, played: 0 });
  });
});

describe('F150-4: every phone format and e-mails are masked (audit question, answers, tool data)', () => {
  const phones = ['+919812345678', '919812345678', '098123 45678', '+91 98123 45678', '+91-9812345678', '9812345678', '0091 98123 45678', '(+91) 98123-45678', '98 12 34 56 78', '+91.98123.45678', '+44 20 7946 0958'];
  it.each(phones)('%s', (p) => {
    for (const f of [maskPii, scrubPii, (s: string) => filterPii(s)]) {
      const out = f(`My number is ${p}, how do I change it?`);
      expect(out).toBe('My number is [phone hidden], how do I change it?');
    }
  });
  it('e-mails (also spaced) and no false positives on scores, dates, pincodes, ids', () => {
    expect(maskPii('a.b@x.co.in or a.b @ gmail . com')).toBe('[email hidden] or [email hidden]');
    for (const s of ['Score 25-21, 25-23 at 19:30 on 2026-10-21', 'pincode 110001', 'match 1700000000000', 'won 3 sets, 15 points']) expect(maskPii(s)).toBe(s);
    expect(filterPii({ msg: 'call +919812345678', nested: ['+91-9812345678'] })).toEqual({ msg: 'call [phone hidden]', nested: ['[phone hidden]'] });
  });
});

describe('Ask lang nit', () => {
  it("en / hi / absent are accepted; anything else is ask_lang", () => {
    expect(checkAskQuestion({ question: 'my teams', lang: 'hi' }).lang).toBe('hi');
    expect(checkAskQuestion({ question: 'my teams' }).lang).toBe('en');
    for (const bad of ['fr', 'EN', '', 3]) expect(() => checkAskQuestion({ question: 'my teams', lang: bad })).toThrow(expect.objectContaining({ code: 'ask_lang' }));
  });
});

describe('intents: F150-7, F150-5, F150-6 and the known misses', () => {
  const tools = (q: string) => { const i = parseIntent(q); return i.kind === 'tools' ? i.calls : i.kind; };
  it.each(['What are my last results?', 'मेरे पिछले नतीजे क्या हैं?', 'mere pichle result kya hain', 'my results', 'Show my last match result'])('F150-7: %s → my_matches past', (q) => {
    expect(tools(q)).toEqual([{ name: 'my_matches', args: { when: 'past', limit: 5 } }]);
  });
  it.each(['How many players can a team have?', 'टीम में कितने खिलाड़ी हो सकते हैं?', 'team mein kitne khiladi ho sakte hain', 'How many points in the deciding set?', 'What is the minimum age to sign up?'])('F150-5: %s → help search, no team lookup', (q) => {
    expect(tools(q)).toBe('rag');
  });
  it.each(['Confirm the result of my last match', 'Approve my match please', 'I want you to mark my match as finished', 'Please confirm my match', 'can you approve the result', 'मेरा मैच कन्फ़र्म करो', 'match confirm kar do', 'mark the match as complete'])('F150-6: %s → write (refused)', (q) => {
    expect(tools(q)).toBe('write');
  });
  it('questions about confirming are not writes', () => {
    expect(tools('How do I confirm a result?')).toBe('rag');
    expect(tools('Is my match confirmed?')).toEqual([{ name: 'my_matches', args: { when: 'all', limit: 5 } }]);
  });
  it("known misses: 'show the ranking' → leaderboard; 'is my match live' → my_matches live", () => {
    expect(tools('show the ranking')).toEqual([{ name: 'leaderboard', args: { limit: 5 } }]);
    expect(tools('ranking')).toEqual([{ name: 'leaderboard', args: { limit: 5 } }]);
    expect(tools('what is my ranking')).toEqual([{ name: 'my_stats', args: {} }]);
    expect(tools('show the ranking of Kabir')).toEqual([{ name: 'player_stats', args: { name: 'kabir' } }]);
    expect(tools('is my match live')).toEqual([{ name: 'my_matches', args: { when: 'live', limit: 5 } }]);
    expect(tools('what is the live score')).toEqual([{ name: 'live_score', args: {} }]);
  });
});

// ---- agent answers with a fake host ----
const liveOther = { ...fin('x1', 'x2', { id: 'lo' }), status: 'live', summary: { setsA: 0, setsB: 0, currentA: 3, currentB: 2, winner: null } } as unknown as Match;
function host(mine: Match[]): ToolHost {
  return {
    viewerId: 't1p1', rankings: async () => ({ ranked: [], me: null, total: 0 }) as never, playerTotals: async () => null, findPlayers: async () => [], names: async () => ({}),
    myMatches: async () => mine, liveMatches: async () => [liveOther], myTeams: async () => [], findTeams: async () => [], tournaments: async () => [], tournamentMatches: async () => [], challengesFor: async () => [],
  };
}
const index = buildIndex();
const ask = (q: string, mine: Match[] = [], lang: 'en' | 'hi' = 'en') => runAgent({ question: q, lang, host: host(mine), index });

describe('F150-7: the match list shows each result state; voided / disputed never read as plain', () => {
  const t = (ms: number, m: Match) => ({ ...m, finishedAt: ms }) as Match;
  const mine = [t(T0 + 5, voided), t(T0 + 4, rejected), t(T0 + 3, awaiting), t(T0 + 2, tooShortConfirmed), t(T0 + 1, counted)];
  it('EN', async () => {
    const r = await ask('What are my last results?', mine);
    expect(r.answer).toBe('Your last 5 results: t1 1–0 t2 (voided by an admin – does not count); t1 1–0 t2 (disputed – rejected by the other captain, not counted); t1 1–0 t2 (pending – waiting for the other captain to confirm); t1 1–0 t2 (under admin review – not counted yet); t1 1–0 t2 (confirmed).');
    const items = (r.cards.find((c) => c.type === 'fixtures') as { items: { result: string }[] }).items;
    expect(items.map((i) => i.result)).toEqual(['voided', 'disputed', 'awaiting', 'review', 'counted']);
  });
  it('a single voided result is never "Your last match: …"', async () => {
    const r = await ask('my last match result', [voided]);
    expect(r.answer).toBe('Your last result: t1 1–0 t2 (voided by an admin – does not count).');
    expect(r.answer).not.toMatch(/Your last match/);
  });
  it('HI / roman', async () => {
    for (const q of ['मेरे पिछले नतीजे क्या हैं?', 'mere pichle result kya hain']) {
      const r = await ask(q, mine, 'hi');
      expect(r.answer).toMatch(/^आपके पिछले 5 नतीजे: t1 1–0 t2 \(एडमिन ने रद्द किया – नहीं गिना जाएगा\); t1 1–0 t2 \(विवादित/);
    }
  });
  it("'is my match live': only the viewer's own live match (not other live matches)", async () => {
    expect((await ask('is my match live', [counted])).answer).toBe('None of your matches is live right now.');
    const myLive = { ...liveOther, id: 'ml', teamA: side('t1'), teamB: side('t3') } as unknown as Match;
    const r = await ask('is my match live', [myLive, counted]);
    expect(r.answer).toBe('Your match is live: t1 v t3 (live, sets 0–0).');
    expect(r.tools.map((x) => x.name)).toEqual(['my_matches']);
  });
});

describe('F150-5 / F150-6 answers', () => {
  it('team size, deciding set, minimum age', async () => {
    expect((await ask('How many players can a team have?')).answer).toMatch(/At least 6 players/);
    expect((await ask('टीम में कितने खिलाड़ी हो सकते हैं?', [], 'hi')).answer).toMatch(/कम से कम 6 खिलाड़ी/);
    expect((await ask('How many points in the deciding set?')).answer).toMatch(/played to 15 points/);
    expect((await ask('निर्णायक सेट कितने पॉइंट का होता है?', [], 'hi')).answer).toMatch(/15 पॉइंट/);
    const age = await ask('What is the minimum age to sign up?');
    expect(age.answer).toMatch(/aged 10 and over/);
    expect(age.answer).not.toMatch(/one-time code/);
  });
  it('confirm / approve / finish: read-only + the screen', async () => {
    const c = await ask('Confirm the result of my last match', [counted]);
    expect(c).toMatchObject({ refusal: 'write', cards: [], tools: [] });
    expect(c.answer).toMatch(/^I can only look things up.*Confirm result/);
    expect((await ask('Approve my match please')).answer).toMatch(/Profile > Admin: Review flagged/);
    expect((await ask('I want you to mark my match as finished')).answer).toMatch(/scorer records the winning rally/);
    expect((await ask('मेरा मैच कन्फ़र्म करो', [], 'hi')).answer).toMatch(/नतीजे की पुष्टि करें/);
  });
});

describe('my_matches tool data carries the state (for a model planner too)', () => {
  it('result per match', async () => {
    const out = await runTool(host([counted, voided]), 'my_matches', { when: 'past' }, 'en');
    expect((out.data as { matches: { result: string }[] }).matches.map((m) => m.result).sort()).toEqual(['counted', 'voided']);
  });
});
