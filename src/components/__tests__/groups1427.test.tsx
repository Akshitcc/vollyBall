/** 1.4.27 (E2E-4): Groups + knockout in the app – create screen (format, plan, draw, preview, play-in hint) and the
 * tournament page (Groups tab with tables, the bracket fed from the groups), EN and HI. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import { assignGroups, generateGroupsKnockout, groupId } from '../../core/groups';
import type { Tournament } from '../../core/types';
import i18n from '../../i18n';

let mockN = 15;
let mockT: Tournament;
let mockMatches: unknown[] = [];
const mockCreate = jest.fn(async (_t: unknown) => 'T');
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'T' }),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true, user: { uid: 'own' } }), useMe: () => ({ id: 'own', name: 'Me' }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}), useProfile: () => null }));
jest.mock('../LocationPicker', () => ({ LocationPicker: ({ onChange }: { onChange: (p: unknown) => void }) => { const R = require('react'); R.useEffect(() => onChange({ name: 'Siri Fort', lat: 28.5, lng: 77.2 }), []); return null; }, placeReady: () => true }));
jest.mock('../RulesEditor', () => ({ RulesEditor: () => null }));
const mockTeam = (i: number) => ({ id: `t${String(i + 1).padStart(2, '0')}`, name: `Team ${String(i + 1).padStart(2, '0')}`, color: '#D93636', captainId: `c${i}`, memberIds: Array.from({ length: 6 }, (_, j) => `u${i}-${j}`), subIds: [], pendingPhones: [] });
jest.mock('../../services/backend', () => ({
  backend: {
    searchTeams: async () => Array.from({ length: mockN }, (_, i) => mockTeam(i)),
    createTournament: (t: unknown) => mockCreate(t),
    watchTournament: (_id: string, cb: (t: Tournament) => void) => { setTimeout(() => cb(mockT), 0); return () => {}; },
    watchTournamentMatches: (_id: string, cb: (m: unknown[]) => void) => { setTimeout(() => cb(mockMatches), 0); return () => {}; },
    watchTeam: () => () => {},
    updateTournament: jest.fn(async () => {}),
    deleteTournament: jest.fn(),
    createMatch: jest.fn(),
  },
}));
afterEach(async () => { await i18n.changeLanguage('en'); jest.clearAllMocks(); });

async function addTeams(n: number) {
  for (let i = 0; i < n; i++) await fireEvent.press(await screen.findByTestId(`add-team-${mockTeam(i).id}`, {}, { timeout: 2000 }));
}

describe('create: Groups + knockout', () => {
  it('15 teams: default 4 groups (4/4/4/3), top 2 → QF, 28 matches; seeded preview; creates groups + seeded bracket', async () => {
    mockN = 15;
    const NewTournament = require('../../app/tournament/new').default;
    await render(<NewTournament />);
    await fireEvent.changeText(screen.getByTestId('tournament-name'), 'Monsoon Cup');
    await addTeams(15);
    await fireEvent.press(screen.getByTestId('format-groups'));
    expect(screen.getByTestId('group-plan-4x2')).toBeTruthy();
    expect(screen.getByText(/4 groups \(4\/4\/4\/3\) · top 2 → Quarter-finals · 28 matches/)).toBeTruthy();
    expect(screen.getByText('21 group matches + 7 knockout matches = 28 matches')).toBeTruthy();
    for (const g of 'ABCD') expect(screen.getByTestId(`preview-group-${g}`)).toBeTruthy();
    expect(screen.getByTestId('preview-group-A')).toHaveTextContent(/Team 01.*Team 08.*Team 09/);
    await fireEvent.press(screen.getByTestId('draw-random'));
    expect(screen.getByTestId('draw-again')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('draw-seeded'));
    await act(async () => { await fireEvent.press(screen.getByTestId('tournament-create')); });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const t = mockCreate.mock.calls[0][0] as Tournament;
    expect(t.format).toBe('groups');
    expect(t.advance).toBe(2);
    expect(t.teams.map((x) => x.group).join('')).toBe('ABCDDCBAABCDCBA');
    expect(t.fixtures.filter((f) => f.group)).toHaveLength(21);
    expect(t.fixtures.filter((f) => !f.group)).toHaveLength(7);
  });
  it('17 teams: groups 5/4/4/4 (35 matches) or a knockout with a play-in (1 match → 16, 16 matches) – EN and HI', async () => {
    mockN = 17;
    const NewTournament = require('../../app/tournament/new').default;
    await render(<NewTournament />);
    await addTeams(17);
    expect(screen.getByTestId('knockout-playin')).toHaveTextContent('Play-in round first: 1 match(es) between 2 teams bring the field to 16; the top seeds get byes. 16 matches in all.');
    await fireEvent.press(screen.getByTestId('format-groups'));
    expect(screen.getByText(/4 groups \(5\/4\/4\/4\) · top 2 → Quarter-finals · 35 matches/)).toBeTruthy();
    await act(async () => { await i18n.changeLanguage('hi'); });
    expect(screen.getByText(/4 ग्रुप \(5\/4\/4\/4\) · टॉप 2 → क्वार्टर फ़ाइनल · 35 मैच/)).toBeTruthy();
    expect(screen.getByText('ग्रुप + नॉकआउट')).toBeTruthy();
  });
  it('fewer than 4 teams: groups is not offered a plan', async () => {
    mockN = 3;
    const NewTournament = require('../../app/tournament/new').default;
    await render(<NewTournament />);
    await addTeams(3);
    await fireEvent.press(screen.getByTestId('format-groups'));
    expect(screen.getByTestId('groups-min')).toHaveTextContent('Groups + knockout needs at least 4 teams.');
  });
});

describe('tournament page: Groups tab and bracket', () => {
  const ids = Array.from({ length: 15 }, (_, i) => mockTeam(i).id);
  const groups = assignGroups(ids, 4, 'seeded');
  const base = (): Tournament => ({
    id: 'T', name: 'Monsoon Cup', organizerId: 'own', format: 'groups', advance: 2, rules: { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 5, winBy: 1, pointCap: null, decidingSetPoints: 5 },
    startDate: Date.now() - 1, endDate: Date.now() + 86400000, location: { name: 'Siri Fort', lat: 28.55, lng: 77.22 },
    teams: ids.map((id, i) => ({ id, name: mockTeam(i).name, color: '#D93636', group: groupId(groups.findIndex((g) => g.includes(id))) })),
    fixtures: generateGroupsKnockout(groups, 2), status: 'running', createdAt: 1,
  });
  const finished = (t: Tournament, fid: string, homeWins: boolean) => {
    const f = t.fixtures.find((x) => x.id === fid)!;
    const side = homeWins ? 'A' : 'B';
    return {
      id: `m-${fid}`, fixtureId: fid, tournamentId: 'T', status: 'finished', rules: t.rules, firstServe: 'A',
      events: Array.from({ length: 5 }, (_, i) => ({ type: 'point', side, at: 1000 + i })),
      teamA: { teamId: f.homeId, name: 'A', color: '#D93636', players: [] }, teamB: { teamId: f.awayId, name: 'B', color: '#001F4D', players: [] },
      summary: { setsA: homeWins ? 1 : 0, setsB: homeWins ? 0 : 1, winner: side, currentA: 0, currentB: 0, setScores: [] },
    };
  };
  async function show(lang: 'en' | 'hi', played: boolean) {
    mockT = base();
    if (played) {
      // every group match: the better seed (lower number) wins
      mockT = { ...mockT, fixtures: mockT.fixtures.map((f) => (f.group ? { ...f, matchId: `m-${f.id}` } : f)) };
      mockMatches = mockT.fixtures.filter((f) => f.group).map((f) => finished(mockT, f.id, f.homeId! < f.awayId!));
    } else mockMatches = [];
    await i18n.changeLanguage(lang);
    const TournamentPage = require('../../app/tournament/[id]').default;
    const r = await render(<TournamentPage />);
    await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
    return r;
  }
  it('EN: Groups / Bracket / Fixtures; four group tables; open slots show their group place', async () => {
    const r = await show('en', false);
    expect(r.getByText('Groups + knockout · 15 teams')).toBeTruthy();
    for (const g of 'ABCD') expect(r.getByTestId(`group-table-${g}`)).toBeTruthy();
    await fireEvent.press(r.getByText('Bracket'));
    expect(r.getByTestId('tournament-bracket')).toHaveTextContent(/Quarter-finals/);
    expect(r.getByTestId('fixture-K1-M0')).toHaveTextContent(/Group A #1.*Group B #2/);
  });
  it('EN: after the group stage the bracket is filled from the tables (A1 v B2) and the top 2 are marked Q', async () => {
    const r = await show('en', true);
    expect(r.getByTestId('group-A')).toHaveTextContent(/Group A · complete/);
    expect(r.getByTestId('qualifies-t01')).toBeTruthy();
    expect(r.getByTestId('qualifies-t08')).toBeTruthy();
    expect(r.queryByTestId('qualifies-t09')).toBeNull();
    await fireEvent.press(r.getByText('Bracket'));
    // A1 = Team 01, B2 = Team 07 (group B: t02, t07, t10, t14)
    expect(r.getByTestId('fixture-K1-M0')).toHaveTextContent(/Team 01.*Team 07/);
  });
  it('HI: tabs, group headings, the open slot label', async () => {
    const r = await show('hi', false);
    expect(r.getByText('ग्रुप + नॉकआउट · 15 टीमें')).toBeTruthy();
    expect(r.getAllByText(/ग्रुप A/).length).toBeGreaterThan(0);
    await fireEvent.press(r.getByText('ब्रैकेट'));
    expect(r.getByTestId('fixture-K1-M0')).toHaveTextContent(/ग्रुप A #1.*ग्रुप B #2/);
  });
});
