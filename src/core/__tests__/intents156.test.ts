/** 1.5.6 (Tester F155-3 / F155-4): set-type words never become a team name ("final set score of X" → X's latest
 * match score); captain / captaincy changes are refused in any wording, questions about the captain are not. */
import { parseIntent } from '../ask/intents';
import { buildIndex } from '../ask';
import { runTool, type ToolHost } from '../ask/tools';
import { runAgent } from '../ask/agent';
import type { Match } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const live = (q: string) => { const i = parseIntent(q); return i.kind === 'tools' ? i.calls.find((c) => c.name === 'live_score') : undefined; };

describe('F155-3: set-type words are never a team name', () => {
  it.each(['tie-break set score?', 'golden set ka score', 'tiebreak score?', 'tie break ka score kya hai', 'final set score?', 'what is the score of the decider set', 'deciding set ka score',
    'super set score', 'टाई ब्रेक सेट का स्कोर?', 'गोल्डन सेट का स्कोर', 'निर्णायक सेट का स्कोर क्या है?'])('%j → live_score, no team', (q) => {
    const c = live(q);
    expect(c).toBeDefined();
    expect(c!.args.team).toBeUndefined();
  });
  it.each([
    ['what was the final set score of Juhu Spikers', 'juhu spikers'], ['Juhu Spikers final set score', 'juhu spikers'], ['deciding set score of Golden Eagles', 'golden eagles'],
    ['golden eagles score', 'golden eagles'], ['tie-break set score of Holdout Hawks', 'holdout hawks'], ['Juhu Spikers ka golden set score', 'juhu spikers'],
  ])('%j → live_score for team %j (not a tournament)', (q, team) => {
    const i = parseIntent(q);
    expect(i.kind === 'tools' && i.calls.map((c) => c.name)).toEqual(['live_score']);
    expect(live(q)!.args.team).toBe(team);
  });
  it('a real tournament final still routes to the tournament tools', () => {
    for (const q of ['Cup final fixtures', 'fixtures of the final', 'Monsoon Cup final schedule']) expect((parseIntent(q) as { calls: { name: string }[] }).calls[0].name).toBe('tournament_fixtures');
  });
});

// ---- the live_score fallback: a named team that isn't live → its latest finished match ----
const { INDOOR_RULES } = require('../rules');
const side = (teamId: string, name: string) => ({ teamId, name, color: '#000000', players: [] });
const done = (id: string, a: string, b: string, at: number, sets: [number, number][]): Match => ({
  id, status: 'finished', rules: INDOOR_RULES, events: [], firstServe: 'A', teamA: side(a, a), teamB: side(b, b), finishedAt: at, startedAt: at - 3_600_000, createdAt: at - 7_200_000, title: '',
  verification: { status: 'confirmed', captain: 'confirmed', by: 'x', at }, playerOfMatchId: 'p1', startedServerAt: at - 3_600_000, finishedServerAt: at,
  summary: { winner: 'A', setsA: sets.filter(([x, y]) => x > y).length, setsB: sets.filter(([x, y]) => y > x).length, setScores: sets.map(([x, y]) => ({ a: x, b: y })) },
} as unknown as Match);
const T0 = 2_000_000_000_000;
const recent = [done('old', 'Juhu Spikers', 'Bandra Blockers', T0 - 86_400_000, [[25, 10], [25, 12]]), done('new', 'Andheri Aces', 'Juhu Spikers', T0, [[25, 23], [20, 25], [15, 13]])];
const host = (withRecent: boolean): ToolHost => ({
  viewerId: 'v', rankings: async () => ({ ranked: [], me: null, total: 0 }) as never, playerTotals: async () => null, findPlayers: async () => [], names: async () => ({}),
  myMatches: async () => [], liveMatches: async () => [], myTeams: async () => [], findTeams: async () => [], tournaments: async () => [], tournamentMatches: async () => [], challengesFor: async () => [],
  ...(withRecent ? { recentMatches: async () => recent } : {}),
});

describe('F155-3: "final set score of <team>" → the team\'s latest match score', () => {
  it('live_score returns the latest finished match of a named team that is not live', async () => {
    const o = await runTool(host(true), 'live_score', { team: 'juhu spikers' }, 'en');
    expect((o.data as unknown as { latest: Record<string, string> }).latest).toMatchObject({ teamA: 'Andheri Aces', teamB: 'Juhu Spikers', sets: '25-23, 20-25, 15-13', lastSet: '15-13' });
  });
  it('the agent answers with the latest match and its final set', async () => {
    const r = await runAgent({ question: 'what was the final set score of Juhu Spikers', lang: 'en', host: host(true), index: buildIndex() });
    expect(r.answer).toMatch(/^juhu spikers is not playing live right now\. Latest match: Andheri Aces 2–1 Juhu Spikers \(25-23, 20-25, 15-13; final set 15-13\)/i);
    expect(r.cards.some((c) => c.type === 'scoreboard')).toBe(true);
  });
  it('no finished match for the team (or no recent host) → the plain "not live" answer', async () => {
    const r = await runAgent({ question: 'final set score of Powai Panthers', lang: 'en', host: host(true), index: buildIndex() });
    expect(r.answer).toMatch(/not playing live right now\.$/);
    const r2 = await runAgent({ question: 'final set score of Juhu Spikers', lang: 'en', host: host(false), index: buildIndex() });
    expect(r2.answer).toMatch(/not playing live right now\.$/);
  });
});

describe('F155-4: captain / captaincy changes → read-only refusal, in any wording', () => {
  it.each([
    'hand over captaincy to Meera', 'hand the captaincy over to Rohan', 'let Meera be the captain', 'Meera should be our captain now, do it', 'switch captain to Rohan',
    'replace me as captain with Meera', 'I want Meera as captain, update it', 'Rohan ko captaincy de do', 'कप्तानी मीरा को सौंप दो', 'CAPTAIN = Meera', 'set captain: Rohan',
    'captain=Meera', 'Captain : Rohan', 'change the captain to Meera please', 'give the armband to Rohan', 'transfer captaincy to Kabir', 'swap captains, Meera takes over – do it',
    'captain Rohan ko bana do', 'Meera ko kaptaan bana do', 'कप्तान बदल दो', 'please make the skipper Rohan', 'can you switch the captain to Meera?',
  ])('%j → write', (q) => expect(parseIntent(q).kind).toBe('write'));
  it.each([
    'name the captain of Juhu Spikers', 'captain kaise chunte hain', 'who can promote a player to captain?', 'how does captaincy handover work?', 'What does a captain do?',
    'Who is the captain of Juhu Spikers?', 'who made Meera captain?', 'did the captain change?', 'when can I change captain?', 'Juhu Spikers captain kaun hai', 'टीम का कप्तान कौन है?',
    'can a captain be changed mid-season?', 'is the captain allowed to change sides?', 'captain of Juhu Spikers',
  ])('%j is not a command', (q) => expect(parseIntent(q).kind).not.toBe('write'));
});
