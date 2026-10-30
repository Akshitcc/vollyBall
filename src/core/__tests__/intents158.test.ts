/** 1.5.8 (Tester F157-2 / F157-3): "which team?" for every team-referencing phrasing, also for teams with no matches;
 * captain help paraphrases get the captain guide; a result dispute that mentions the other captain gets the dispute /
 * admin answer, not a refusal. */
import { bareTeamName, parseIntent } from '../ask/intents';
import { buildIndex, GUIDES } from '../ask';
import { rankTeamNames, runTool, type ToolHost } from '../ask/tools';
import { runAgent } from '../ask/agent';
import type { Match, Team } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const team = (id: string, name: string) => ({ id, name, color: '#000000', captainId: 'c', memberIds: ['c'], subIds: [], pendingPhones: [] } as unknown as Team);
const TEAMS = [team('j1', 'Juhu Jets'), team('j2', 'Juhu Jaguars'), team('b1', 'Bandra Blockers')];
const host = (extra: Partial<ToolHost> = {}): ToolHost => ({
  viewerId: 'v', rankings: async () => ({ ranked: [], me: null, total: 0 }) as never, playerTotals: async () => null, findPlayers: async () => [], names: async () => ({ c: 'Cap' }),
  myMatches: async () => [], liveMatches: async () => [], myTeams: async () => [], tournaments: async () => [], tournamentMatches: async () => [], challengesFor: async () => [],
  findTeams: async (q: string) => TEAMS.filter((t) => q.toLowerCase().split(' ').some((w) => t.name.toLowerCase().includes(w))), recentMatches: async () => [], ...extra,
});
const ask = (question: string, lang: 'en' | 'hi' = 'en', h = host()) => runAgent({ question, lang, host: h, index: buildIndex() });

describe('F157-2: team phrasings route to a team lookup', () => {
  it.each([
    ['Juhu last result', 'live_score'], ['last result of Juhu', 'live_score'], ['how did Juhu do', 'live_score'], ['is Juhu playing', 'live_score'],
    ['Juhu ka last result kya tha', 'live_score'], ['show Juhu', 'team_roster'], ['tell me about Juhu team', 'team_roster'], ['about Juhu team', 'team_roster'],
  ])('%j → %s(team: juhu)', (q, tool) => expect(parseIntent(q)).toEqual({ kind: 'tools', calls: [{ name: tool, args: { team: 'juhu' } }] }));
  it.each(['show my matches', 'show the rankings', 'how did I do', 'how do I create a team', 'is it raining', 'show me matches near me'])('%j is not a team lookup', (q) => {
    const i = parseIntent(q);
    expect(i.kind === 'tools' && i.calls.some((c) => (c.name === 'team_roster' || c.name === 'live_score') && c.args.team)).toBe(false);
  });
  it('bare team names', () => {
    expect(bareTeamName('Juhu')).toBe('juhu');
    expect(bareTeamName('Juhu Jets?')).toBe('juhu jets');
    for (const q of ['my teams', 'rules', 'the score', 'what is a libero and how does it work in indoor volleyball']) expect(bareTeamName(q)).toBeNull();
  });
  it('rankTeamNames: exact first, else everything within the gap', () => {
    expect(rankTeamNames('JUHU JETS', ['Juhu Jaguars', 'Juhu Jets'])).toEqual({ exact: 'Juhu Jets', close: ['Juhu Jets'] });
    expect(rankTeamNames('juhu', ['Juhu Jaguars', 'Juhu Jets', 'Bandra Blockers']).close.sort()).toEqual(['Juhu Jaguars', 'Juhu Jets']);
    expect(rankTeamNames('powai', ['Juhu Jets']).close).toEqual([]);
  });
});

describe('F157-2: "which team?" also for teams with NO matches (EN + HI)', () => {
  const Q = ['final set score of Juhu', 'Juhu score', 'Juhu ka score kya hai', 'Juhu last result', 'how did Juhu do', 'is Juhu playing', 'show Juhu', 'Juhu', 'tell me about Juhu team'];
  it.each(Q)('%j → candidates listed, no guess', async (q) => {
    const r = await ask(q);
    expect(r.answer).toMatch(/^Several teams match: Juhu (Jets|Jaguars), Juhu (Jets|Jaguars)\. Which one do you mean\?$/);
    const hi = await ask(q, 'hi');
    expect(hi.answer).toMatch(/^कई टीमें मिलीं: .*आप किसकी बात कर रहे हैं\?$/);
  });
  it('one team with matches and one without → still asks', async () => {
    const { INDOOR_RULES } = require('../rules');
    const side = (n: string) => ({ teamId: n, name: n, color: '#000000', players: [] });
    const m = { id: 'm1', status: 'finished', rules: INDOOR_RULES, events: [], firstServe: 'A', teamA: side('Juhu Jets'), teamB: side('Bandra Blockers'), finishedAt: 2e12, summary: { winner: 'A', setsA: 2, setsB: 0, setScores: [{ a: 25, b: 10 }, { a: 25, b: 11 }] } } as unknown as Match;
    const o = await runTool(host({ recentMatches: async () => [m] }), 'live_score', { team: 'juhu' }, 'en');
    expect((o.data as { ambiguous?: string[] }).ambiguous?.sort()).toEqual(['Juhu Jaguars', 'Juhu Jets']);
    const exact = await runTool(host({ recentMatches: async () => [m] }), 'live_score', { team: 'juhu jets' }, 'en');
    expect((exact.data as { latest?: { teamA: string } }).latest?.teamA).toBe('Juhu Jets');
  });
  it('an exact or single team is answered directly', async () => {
    expect((await ask('show Bandra Blockers')).answer).toBe('Bandra Blockers has 1 player(s). Captain: Cap.');
    expect((await ask('Bandra Blockers')).answer).toBe('Bandra Blockers has 1 player(s). Captain: Cap.');
  });
  it('a bare word that is no team and no help topic stays "I don\'t know"', async () => {
    expect((await ask('Zanzibar')).idk).toBe(true);
  });
});

describe('F157-3: captain help paraphrases → captain guide; dispute → dispute answer', () => {
  const guide = GUIDES.find((g) => g.id === 'guide-captain')!;
  it.each(['What does a captain do?', 'what are the captain responsibilities?', 'captain responsibilities', 'can the captain be changed after a match starts?', 'does the captain need to be a member of the team?',
    'what powers does a captain have?', 'how do I step down as captain?', 'can the captain confirm the score?', "what is the captain's role?", 'kaptaan ka kaam kya hai?', 'कप्तान क्या करता है?'])('%j → captain guide', async (q) => {
    expect(parseIntent(q)).toEqual({ kind: 'rag', topic: 'captain' });
    const r = await ask(q);
    expect(r.answer).toBe(guide.en.text);
    expect(r.sources.map((s) => s.id)).toEqual(['guide-captain']);
  });
  it('the guide covers confirming results and stepping down (EN + HI)', () => {
    expect(guide.en.text).toMatch(/other team's captain confirms the result/);
    expect(guide.en.text).toMatch(/no button to step down/);
    expect(guide.hi.text).toMatch(/पुष्टि/);
  });
  it('"step me down and make Meera captain" → refused', () => expect(parseIntent('step me down and make Meera captain').kind).toBe('write'));
  it.each(['Other captain rejected our result, can admin make it count?', 'the other captain disputed the score, what now?', 'our result was rejected by their captain, will the admin void it?'])('%j → the dispute / admin answer, not a refusal', async (q) => {
    const r = await ask(q);
    expect(r.refusal).toBeNull();
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.answer).toMatch(/disputed|admin/i);
    expect(r.answer).not.toMatch(/creates a team is its captain/);
  });
  it('real captain changes in dispute wording are still refused', () => {
    for (const q of ['the other captain rejected it, so make Meera captain', 'admin, set Rohan as captain']) expect(parseIntent(q).kind).toBe('write');
  });
});
