/** 1.5.7 (Tester F156-2 / F156-5 / F156-6): the latest-match team lookup ranks by name-match quality (exact first, then
 * the best fuzzy score, date only as a tie-break) and asks "which team?" when several teams match equally; a team
 * missing from the recent window is looked up directly; captain changes are refused in any form and captain questions
 * get the captain guide (never the fair-play FAQ). */
import { parseIntent } from '../ask/intents';
import { buildIndex, GUIDES } from '../ask';
import { pickTeam, runTool, type ToolHost } from '../ask/tools';
import { runAgent } from '../ask/agent';
import type { Match } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const { INDOOR_RULES } = require('../rules');
const side = (teamId: string, name: string) => ({ teamId, name, color: '#000000', players: [] });
const done = (id: string, a: string, b: string, at: number, sets: [number, number][], extra: Partial<Match> = {}): Match => ({
  id, status: 'finished', rules: INDOOR_RULES, events: [], firstServe: 'A', teamA: side(a, a), teamB: side(b, b), finishedAt: at, startedAt: at - 3_600_000, createdAt: at - 7_200_000, title: '',
  verification: { status: 'confirmed', captain: 'confirmed', by: 'x', at }, playerOfMatchId: 'p1', startedServerAt: at - 3_600_000, finishedServerAt: at,
  summary: { winner: 'A', setsA: sets.filter(([x, y]) => x > y).length, setsB: sets.filter(([x, y]) => y > x).length, setScores: sets.map(([x, y]) => ({ a: x, b: y })) },
  ...extra,
} as unknown as Match);
const T0 = 2_000_000_000_000, DAY = 86_400_000;
const host = (recent: Match[], extra: Partial<ToolHost> = {}): ToolHost => ({
  viewerId: 'v', rankings: async () => ({ ranked: [], me: null, total: 0 }) as never, playerTotals: async () => null, findPlayers: async () => [], names: async () => ({}),
  myMatches: async () => [], liveMatches: async () => [], myTeams: async () => [], findTeams: async () => [], tournaments: async () => [], tournamentMatches: async () => [], challengesFor: async () => [],
  recentMatches: async () => recent, ...extra,
});
const latest = (o: { data: unknown }) => (o.data as { latest?: Record<string, string> }).latest;
const amb = (o: { data: unknown }) => (o.data as { ambiguous?: string[] }).ambiguous;

describe('F156-2: name-match quality first, date only as a tie-break', () => {
  const herons = done('h', 'Juhu Herons', 'Bandra Blockers', T0 - 5 * DAY, [[25, 10], [25, 12]]);
  const hornets = done('n', 'Andheri Aces', 'Juhu Hornets', T0, [[25, 23], [25, 20]]);
  const heronsOld = done('h0', 'Juhu Herons', 'Powai Panthers', T0 - 20 * DAY, [[25, 1], [25, 2]]);
  it('an exact (case-insensitive) team name wins over a newer fuzzy match', async () => {
    const o = await runTool(host([hornets, herons, heronsOld]), 'live_score', { team: 'JUHU HERONS' }, 'en');
    expect(latest(o)).toMatchObject({ teamA: 'Juhu Herons', teamB: 'Bandra Blockers' });
  });
  it('the exact team\'s newest match is picked (date as tie-break within a team)', () => {
    expect(pickTeam('juhu herons', [heronsOld, hornets, herons]).matches.map((m) => m.id)).toEqual(['h', 'h0']);
  });
  it('the best fuzzy score wins when it is clearly better (a typo of one team)', () => {
    const r = pickTeam('juhu heron', [hornets, herons]);
    expect(r.ambiguous).toEqual([]);
    expect(r.matches[0].id).toBe('h');
  });
  it('"Juhu" matches Herons and Hornets equally → ask which team, list both, no guess', async () => {
    const o = await runTool(host([hornets, herons]), 'live_score', { team: 'juhu' }, 'en');
    expect(latest(o)).toBeUndefined();
    expect(amb(o)!.sort()).toEqual(['Juhu Herons', 'Juhu Hornets']);
    const r = await runAgent({ question: 'Juhu score?', lang: 'en', host: host([hornets, herons]), index: buildIndex() });
    expect(r.answer).toMatch(/Several teams match: .*Juhu (Herons|Hornets).*Juhu (Herons|Hornets).*Which one do you mean\?/);
    const hi = await runAgent({ question: 'Juhu ka score?', lang: 'hi', host: host([hornets, herons]), index: buildIndex() });
    expect(hi.answer).toMatch(/कई टीमें मिलीं: .*आप किसकी बात कर रहे हैं\?/);
  });
  it('one team only → no question, its latest match', async () => {
    const o = await runTool(host([herons, heronsOld]), 'live_score', { team: 'juhu' }, 'en');
    expect(latest(o)).toMatchObject({ teamA: 'Juhu Herons', teamB: 'Bandra Blockers' });
  });
  it('ambiguity among LIVE matches also asks', async () => {
    const lv = (m: Match) => ({ ...m, status: 'live', finishedAt: undefined } as unknown as Match);
    const o = await runTool(host([], { liveMatches: async () => [lv(herons), lv(hornets)] }), 'live_score', { team: 'juhu' }, 'en');
    expect(amb(o)!.length).toBe(2);
  });
});

describe('F156-5: finished_at order; a team outside the window is queried directly', () => {
  it('an older match touched recently does not beat the newer finished one', () => {
    const older = done('o', 'Twin Terns', 'Bandra Blockers', T0 - 10 * DAY, [[25, 5], [25, 6]], { updatedAt: T0 + DAY } as never);
    const newer = done('w', 'Twin Terns', 'Andheri Aces', T0, [[25, 20], [25, 21]]);
    expect(pickTeam('twin terns', [older, newer]).matches[0].id).toBe('w');
  });
  it('not in the window → host.teamMatches is asked and its latest match answered', async () => {
    const asked: string[] = [];
    const h = host([done('x', 'Andheri Aces', 'Bandra Blockers', T0, [[25, 1], [25, 2]])], { teamMatches: async (q: string) => { asked.push(q); return [done('t', 'Twin Terns', 'Powai Panthers', T0 - 400 * DAY, [[25, 9], [25, 8]])]; } });
    const o = await runTool(h, 'live_score', { team: 'twin terns' }, 'en');
    expect(asked).toEqual(['twin terns']);
    expect(latest(o)).toMatchObject({ teamA: 'Twin Terns', teamB: 'Powai Panthers' });
  });
  it('no team match anywhere → the plain "not live" answer (no wrong team)', async () => {
    const h = host([done('x', 'Andheri Aces', 'Bandra Blockers', T0, [[25, 1], [25, 2]])], { teamMatches: async () => [] });
    const r = await runAgent({ question: 'final set score of Twin Terns', lang: 'en', host: h, index: buildIndex() });
    expect(r.answer).toMatch(/not playing live right now\.$/);
  });
});

describe('F156-6: captain changes refused in any form', () => {
  it.each(['switch captain to Rohan?', 'how about you make Meera captain', 'why not make Rohan captain right now', 'is it possible to make Meera captain now? do it',
    'when you get a chance, switch captain to Rohan', 'Meera = captain', 'captain -> Rohan', 'do it: Meera captain', 'Rohan → captain', 'CAPTAIN = Meera',
    'can you switch the captain to Meera?', 'Rohan ko captaincy de do', 'कप्तानी मीरा को सौंप दो', 'name Meera as our captain'])('%j → write', (q) => expect(parseIntent(q).kind).toBe('write'));
  it('the refusal explains how captains work', async () => {
    const r = await runAgent({ question: 'Meera = captain', lang: 'en', host: host([]), index: buildIndex() });
    expect(r.refusal).toBe('write');
    expect(r.answer).toMatch(/creates a team is its captain.*New match/);
  });
});

describe('F156-6: captain questions → the captain guide (EN + HI), never the fair-play FAQ', () => {
  const guide = GUIDES.find((g) => g.id === 'guide-captain')!;
  it('the guide exists in EN and HI', () => {
    expect(guide.en.text).toMatch(/creates a team is its captain/);
    expect(guide.en.text).toMatch(/picked in New match/);
    expect(guide.hi.text).toMatch(/कप्तान/);
    expect(guide.hi.text).toMatch(/नया मैच/);
  });
  const QS = ['steps to change captain', 'change captain how?', 'Explain how captaincy transfer works', 'how can I transfer captaincy?', 'kya main captain badal sakta hoon?',
    'how do I change captain?', 'is it possible to change the captain?', 'where can I change the captain', 'when can I change the captain', 'which screen lets me switch captain?',
    'captain kaun hai?', 'can I hand over captaincy to Rohan?', 'who can promote a player to captain?', 'कप्तान कैसे बदलें?'];
  it.each(QS)('%j → captain guide answer', async (q) => {
    expect(parseIntent(q)).toEqual({ kind: 'rag', topic: 'captain' });
    for (const lang of ['en', 'hi'] as const) {
      const r = await runAgent({ question: q, lang, host: host([]), index: buildIndex() });
      expect(r.refusal).toBeNull();
      expect(r.idk).toBe(false);
      expect(r.sources.map((s) => s.id)).toEqual(['guide-captain']);
      expect(r.answer).toBe(guide[lang].text);
      expect(r.answer).not.toMatch(/fair play|fair-play|फ़ेयर प्ले/i);
    }
  });
  it.each([['Who is the captain of Juhu Spikers?', 'juhu spikers'], ['Juhu Spikers captain kaun hai', 'juhu spikers'], ['name the captain of Delhi Smashers', 'delhi smashers']])('%j → team_roster %j', (q, team) => {
    expect(parseIntent(q)).toEqual({ kind: 'tools', calls: [{ name: 'team_roster', args: { team } }] });
  });
});
