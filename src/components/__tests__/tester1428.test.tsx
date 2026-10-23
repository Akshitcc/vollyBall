/** 1.5.0: Tester's Low items from 1.4.28 – V1428-2 (long names in 360 px group tables, the HI 'आगे' badge gap),
 * V1428-3 (Night team dots get a contrasting ring), V1428-4 (bracket scroll hint, narrower cards, champion on the final). */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import { assignGroups, generateGroupsKnockout, groupId } from '../../core/groups';
import { generateKnockout } from '../../core/tournament';
import type { Tournament } from '../../core/types';
import i18n from '../../i18n';
import { applyTheme, contrast } from '../../theme';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';

let mockT: Tournament;
let mockMatches: unknown[] = [];
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
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true, user: { uid: 'viewer' } }), useMe: () => ({ id: 'viewer', name: 'Me' }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}), useProfile: () => null }));
jest.mock('../../services/backend', () => ({
  backend: {
    watchTournament: (_id: string, cb: (t: Tournament) => void) => { setTimeout(() => cb(mockT), 0); return () => {}; },
    watchTournamentMatches: (_id: string, cb: (m: unknown[]) => void) => { setTimeout(() => cb(mockMatches), 0); return () => {}; },
    watchTeam: () => () => {},
    updateTournament: jest.fn(async () => {}),
    deleteTournament: jest.fn(),
    createMatch: jest.fn(),
  },
}));
afterEach(async () => { applyTheme('day'); await i18n.changeLanguage('en'); });
const flat = (s: unknown) => StyleSheet.flatten(s as never) as Record<string, unknown>;
const LONG = 'Goregaon Giants Volleyball Club Under-21';
const NAVY = '#001F4D';
const rules: Tournament['rules'] = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 5, winBy: 1, pointCap: null, decidingSetPoints: 5 };
const done = (fid: string, a: string, b: string, homeWins: boolean, t: Tournament) => ({
  id: `m-${fid}`, fixtureId: fid, tournamentId: 'T', status: 'finished', rules: t.rules, firstServe: 'A',
  events: Array.from({ length: 5 }, (_, i) => ({ type: 'point', side: homeWins ? 'A' : 'B', at: 1000 + i })),
  teamA: { teamId: a, name: 'A', color: NAVY, players: [] }, teamB: { teamId: b, name: 'B', color: NAVY, players: [] },
  summary: { setsA: homeWins ? 1 : 0, setsB: homeWins ? 0 : 1, winner: homeWins ? 'A' : 'B', currentA: 0, currentB: 0, setScores: [] },
});
const names = ['Juhu Spikers', LONG, 'Colaba Aces', 'Dadar Diggers', 'Bandra Blockers', 'Malad Smashers', 'Powai Setters', 'Andheri Liberos'];

function groupsT(): Tournament {
  const ids = names.map((_, i) => `t0${i + 1}`);
  const groups = assignGroups(ids, 2, 'seeded');
  return {
    id: 'T', name: 'QA Groups', organizerId: 'org', format: 'groups', advance: 2, rules,
    startDate: Date.now() - 1, endDate: Date.now() + 86400000, location: { name: 'Juhu', lat: 19.1, lng: 72.8 },
    teams: ids.map((id, i) => ({ id, name: names[i], color: NAVY, group: groupId(groups.findIndex((g) => g.includes(id))) })),
    fixtures: generateGroupsKnockout(groups, 2), status: 'running', createdAt: 1,
  };
}
async function show(t: Tournament, matches: unknown[], lang: 'en' | 'hi', theme: 'day' | 'night') {
  mockT = t; mockMatches = matches;
  applyTheme(theme);
  await i18n.changeLanguage(lang);
  const Page = require('../../app/tournament/[id]').default;
  const ctx = { name: theme, t: tokens[theme], setting: theme, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 };
  const r = await render(<ThemeContext.Provider value={ctx as never}><Page /></ThemeContext.Provider>);
  await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
  return r;
}

describe('V1428-2: long names in the group tables', () => {
  it('a long name may wrap to 2 lines and shrink; it is never single-line clipped', async () => {
    const r = await show(groupsT(), [], 'en', 'day');
    const name = r.getByTestId('table-name-t02');
    expect(name).toHaveTextContent(LONG);
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    expect(flat(name.props.style).flexShrink).toBe(1);
  });
  it('HI: the qualified badge (आगे) is its own pill with a gap and does not shrink', async () => {
    let t = groupsT();
    t = { ...t, fixtures: t.fixtures.map((f) => (f.group ? { ...f, matchId: `m-${f.id}` } : f)) };
    const m = t.fixtures.filter((f) => f.group).map((f) => done(f.id, f.homeId!, f.awayId!, f.homeId! < f.awayId!, t));
    const r = await show(t, m, 'hi', 'night');
    const badge = r.getByTestId('qualifies-t01');
    expect(badge).toHaveTextContent('आगे');
    const st = flat(badge.props.style);
    expect(st.marginLeft).toBeGreaterThanOrEqual(6);
    expect(st.flexShrink).toBe(0);
    expect(badge.props.accessibilityLabel).toBeTruthy();
  });
});

describe('V1428-3: team dots are visible on Night cards', () => {
  it('Night: a navy team dot has a light ring with strong contrast to the card', async () => {
    const r = await show(groupsT(), [], 'en', 'night');
    const d = flat(r.getByTestId('table-dot-t01').props.style);
    expect(d.backgroundColor).toBe(NAVY);
    expect(d.borderWidth).toBeGreaterThanOrEqual(1.5);
    expect(contrast(String(d.borderColor), tokens.night.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(String(d.borderColor), NAVY)).toBeGreaterThanOrEqual(3);
  });
  it('Day keeps the outline ring', async () => {
    const r = await show(groupsT(), [], 'en', 'day');
    const d = flat(r.getByTestId('table-dot-t01').props.style);
    expect(d.borderColor).toBe(tokens.day.outline);
    expect(d.borderWidth).toBeGreaterThanOrEqual(1.5);
  });
});

describe('V1428-4: bracket at 360 px', () => {
  const koT = (): Tournament => ({
    id: 'T', name: 'Monsoon Cup', organizerId: 'org', format: 'knockout', rules,
    startDate: Date.now() - 1, endDate: Date.now() + 86400000, location: { name: 'Juhu', lat: 19.1, lng: 72.8 },
    teams: names.slice(0, 4).map((n, i) => ({ id: `t0${i + 1}`, name: n, color: NAVY })),
    fixtures: generateKnockout(['t01', 't02', 't03', 't04']).map((f) => ({ ...f, matchId: `m-${f.id}` })), status: 'running', createdAt: 1,
  });
  it('shows a sideways-scroll hint and narrow cards so the next round starts on screen', async () => {
    const t = koT();
    const r = await show(t, [], 'en', 'day');
    expect(r.getByTestId('bracket-scroll-hint')).toHaveTextContent('Swipe sideways for the later rounds →');
    const card = flat(r.getByTestId('fixture-R1-M0').props.style);
    expect(Number(card.width)).toBeLessThanOrEqual(170);
    expect(r.getByTestId('tournament-bracket').props.showsHorizontalScrollIndicator).toBe(true);
  });
  it('the finished final names the champion (EN and HI); earlier rounds do not', async () => {
    const t = koT();
    const m = [done('R1-M0', 't01', 't04', true, t), done('R1-M1', 't02', 't03', true, t), done('R2-M0', 't01', 't02', false, t)];
    const r = await show(t, m, 'en', 'night');
    expect(r.getByTestId('fixture-champion-R2-M0')).toHaveTextContent(`🏆 Champion: ${LONG}`);
    expect(r.queryByTestId('fixture-champion-R1-M0')).toBeNull();
    await act(async () => { await i18n.changeLanguage('hi'); });
    expect(r.getByTestId('fixture-champion-R2-M0')).toHaveTextContent(`🏆 चैंपियन: ${LONG}`);
    expect(r.getByTestId('bracket-scroll-hint')).toHaveTextContent(/स्वाइप/);
  });
});
