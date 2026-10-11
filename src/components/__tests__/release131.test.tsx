/**
 * 1.3.1 (QA retest of 1.3.0): wallet points history (C130-7), Profile rank card and Career stats from
 * one source (C130-8), named colour swatches (C130-9).
 */
import { act, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';
import { TEAM_COLORS, type Match } from '../../core/types';
import { ANTI_FRAUD, MIN_MATCH_MS, playerWallet, walletFromTotals, walletHistory, type WalletMatchLine } from '../../core/antifraud';
import { profileCareer } from '../../core/stats';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false, termsOk: true }),
  useMe: () => ({ id: 'a1', name: 'Aarav', phone: '+919876543210', photoURL: null, city: '' }),
}));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
const mockBackend = {
  getWallet: jest.fn(),
  getRankings: jest.fn(),
  watchMyMatches: jest.fn(),
  watchMyTeams: jest.fn((_u: string, cb: (t: unknown[]) => void) => (cb([]), () => {})),
  listMemories: jest.fn(async () => []),
  searchTeams: jest.fn(async () => [] as unknown[]),
  createTeam: jest.fn(async () => 'T1'),
  findUserByPhone: jest.fn(async () => null),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

const QUICK = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 7, 6, 0); // a Monday morning IST
/** Match i: a1's side wins (or loses), a1 credited `credit` points, a different opponent each time, one per day. */
function mk(i: number, o: { win?: boolean; credit?: number; potm?: string; verified?: boolean } = {}): Match {
  const { win = true, credit = 2, potm = 'a2', verified = true } = o;
  let ev: MatchEvent[] = [];
  const side = win ? 'A' : 'B';
  for (let k = 0; k < 3; k++) ev = addPoint(QUICK, ev, side, { at: 1, playerId: side === 'A' ? (k < credit ? 'a1' : 'a2') : 'b1' });
  const fin = T0 + i * DAY;
  return {
    id: `m${i}`,
    status: 'finished',
    teamA: { teamId: 'tA', name: 'Delhi Smashers', color: '#D93636', players: [{ id: 'a1', name: 'Aarav' }, { id: 'a2', name: 'Ishaan' }] },
    teamB: { teamId: `tB${i}`, name: `Opponents ${i}`, color: '#001F4D', players: [{ id: 'b1', name: 'Kavya' }, { id: 'b2', name: 'Meera' }] },
    captains: { A: 'a1', B: 'b1' },
    rules: QUICK,
    firstServe: 'A',
    events: ev,
    summary: summarize(computeState(QUICK, ev, 'A')),
    createdBy: 'a1',
    scorerId: 'a1',
    playerOfMatchId: potm,
    verification: verified ? { status: 'confirmed', by: 'b1', at: fin } : null,
    startedServerAt: fin - MIN_MATCH_MS - 60_000,
    finishedServerAt: fin,
    finishedAt: fin,
    startedAt: fin - MIN_MATCH_MS - 60_000,
    createdAt: 1,
    updatedAt: fin,
    participantIds: ['a1', 'a2', 'b1', 'b2'],
  } as unknown as Match;
}

describe('C130-7: points history (core)', () => {
  const line = (i: number, won: boolean, credited = 1, potm = false): WalletMatchLine => ({ matchId: `m${i}`, at: T0 + i * DAY, opponent: `T${i}`, won, potm, credited });
  it('one row per counted match, a bonus row at every 5th counted win, newest first', () => {
    const lines = [line(1, true), line(2, false), line(3, true), line(4, true, 3, true), line(5, true), line(6, true), line(7, true)];
    const h = walletHistory([...lines].reverse()); // input order doesn't matter
    expect(h.map((x) => (x.kind === 'bonus' ? `bonus@${x.matchId}:${x.wins}` : x.matchId))).toEqual(['m7', 'bonus@m6:5', 'm6', 'm5', 'm4', 'm3', 'm2', 'm1']);
    expect(h.find((x) => x.matchId === 'm4' && x.kind === 'match')!.points).toBe(3 + 10 + 25); // credited + win + POTM
    expect(h.find((x) => x.matchId === 'm2')!.points).toBe(1);
    expect(h.find((x) => x.kind === 'bonus')!.points).toBe(ANTI_FRAUD.BONUS_POINTS);
  });
  it('the rows add up to the wallet balance (same counted matches, nothing stored)', () => {
    const ms = [mk(1), mk(2, { win: false }), mk(3, { potm: 'a1' }), mk(4), mk(5), mk(6), mk(7, { verified: false })];
    const w = playerWallet(ms, 'a1');
    expect(w.history.filter((x) => x.kind === 'match').map((x) => x.matchId).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']); // m7 isn't confirmed
    expect(w.history.some((x) => x.kind === 'bonus')).toBe(true); // 5 counted wins
    expect(w.history.reduce((n, x) => n + x.points, 0)).toBe(w.balance);
    expect(walletFromTotals({ points: w.points, wins: w.wins, potm: w.potm, matches: w.countedMatches }).balance).toBe(w.balance);
    expect(JSON.stringify(w.history)).not.toMatch(/redeem|cash|withdraw|rupee|₹/i);
  });
});

describe('C130-7: wallet screen lists the history', () => {
  const ms = [mk(1), mk(2, { win: false }), mk(3, { potm: 'a1' }), mk(4), mk(5), mk(6)];
  const wallet = playerWallet(ms, 'a1');
  beforeEach(() => mockBackend.getWallet.mockImplementation(async () => wallet));
  it.each(['en', 'hi'])('%s: rows for matches and the bonus, newest first, no cash/redeem words', async (lng) => {
    await i18n.changeLanguage(lng);
    const Wallet = require('../../app/wallet').default;
    await render(<Wallet />);
    await act(async () => {});
    expect(screen.getByTestId('wallet-history')).toBeTruthy();
    expect(screen.getByTestId('wallet-history-match-m6')).toBeTruthy();
    expect(screen.getByTestId('wallet-history-bonus-m6')).toBeTruthy();
    expect(screen.getByTestId('wallet-history-match-m3').props.accessibilityLabel).toContain(i18n.t('potm.title'));
    expect(screen.getByTestId('wallet-history-match-m2').props.accessibilityLabel).toContain(i18n.t('wallet.historyLoss'));
    const text = JSON.stringify(screen.toJSON());
    expect(text).toContain(i18n.t('wallet.history'));
    expect(text).not.toMatch(/redeem|withdraw|cash ?out|₹|rupee|रुपये|रिडीम|निकाल/i);
    await i18n.changeLanguage('en');
  });
});

describe('C130-8: rank card and Career stats share one source', () => {
  it('profileCareer: only the counted matches; "–" while loading or failed; the rest are "not counted yet"', () => {
    const ms = [mk(1), mk(2), mk(3, { verified: false })];
    expect(profileCareer('a1', ms, undefined)).toEqual({ stats: null, notCounted: 0 });
    expect(profileCareer('a1', ms, null).stats).toBeNull();
    const r = profileCareer('a1', ms, { myCountedMatchIds: ['m1', 'm2'] });
    expect(r.stats).toMatchObject({ matches: 2, wins: 2 });
    expect(r.notCounted).toBe(1);
  });

  it.each(['en', 'hi'])('%s: Profile shows the same matches on the rank card and in Career stats (never 0 next to 3)', async (lng) => {
    await i18n.changeLanguage(lng);
    const ms = [mk(1), mk(2), mk(3, { verified: false })];
    const row = { playerId: 'a1', name: 'Aarav', matches: 2, wins: 2, points: 4, potm: 0, rankingPoints: 24, winPct: 100, rank: null };
    mockBackend.getRankings.mockImplementation(async () => ({ ranked: [], total: 0, minMatches: 3, me: row, myCountedMatchIds: ['m1', 'm2'] }));
    mockBackend.watchMyMatches.mockImplementation((_u: string, cb: (m: Match[]) => void) => (cb(ms), () => {}));
    const Profile = require('../../app/(tabs)/profile').default;
    await render(<Profile />);
    await act(async () => {});
    expect(screen.getByTestId('profile-rank-matches').props.children).toBe(2);
    expect(screen.getByTestId('career-matches').props.accessibilityLabel).toBe(`${i18n.t('profile.matches')}: 2`);
    expect(screen.getByTestId('career-wins').props.accessibilityLabel).toBe(`${i18n.t('profile.wins')}: 2`);
    expect(screen.getByTestId('career-not-counted')).toHaveTextContent(i18n.t('profile.notCountedYet', { count: 1 }));
    expect(screen.getByTestId('profile-form').props.children).toHaveLength(2); // W/L chips: counted matches only
    await i18n.changeLanguage('en');
  });
});

describe('C130-9: every team colour swatch has a spoken name (EN/HI)', () => {
  const { colourName, swatchLabel } = require('../../i18n/format');
  it.each(['en', 'hi'])('%s: all presets are named, distinct and not hex codes', async (lng) => {
    await i18n.changeLanguage(lng);
    const names = TEAM_COLORS.map((c) => colourName(c));
    for (const n of names) expect(n).not.toMatch(/#|[0-9A-F]{6}/i);
    expect(new Set(names).size).toBe(TEAM_COLORS.length);
    if (lng === 'hi') for (const n of names) expect(n).toMatch(/[\u0900-\u097F]/);
    expect(colourName('#123456')).toContain('#123456'); // unknown colours still say something
    await i18n.changeLanguage('en');
  });
  it.each(['en', 'hi'])('%s: New team and the match team builder label their swatches', async (lng) => {
    await i18n.changeLanguage(lng);
    const NewTeam = require('../../app/team/new').default;
    await render(<NewTeam />);
    for (const c of TEAM_COLORS) expect(screen.getByTestId(`team-colour-${c.slice(1)}`).props.accessibilityLabel).toBe(swatchLabel(c));
    expect(screen.getByTestId('team-colour-D93636').props.accessibilityLabel).toBe(lng === 'hi' ? 'टीम का रंग: लाल' : 'Team colour: Red');
    await i18n.changeLanguage('en');
  });
  it('TeamBuilder swatches too', async () => {
    const { TeamBuilder } = require('../TeamBuilder');
    await render(<TeamBuilder value={{ kind: 'build', name: 'X', color: '#D93636', players: [] }} otherPlayerIds={[]} onChange={() => {}} testID="tb" />);
    expect(screen.getByTestId('swatch-tb-001F4D').props.accessibilityLabel).toBe('Team colour: Navy blue');
  });
});
