/**
 * 1.3.9 UI: V138-10 (how the Player of the Match was picked), V138-12 (one confirm message, POTM label
 * wraps), V138-13 (admin links on Profile, admins only), V138-14 (short admin buttons + subtitles, Hindi
 * wording), V138-11 (Profile/admin lists use the match date).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import type { Match } from '../../core/types';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
let mockIsAdmin = false;
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin, termsOk: true, user: { uid: 'a1' } }),
  useMe: () => ({ id: 'a1', name: 'Aarav', phone: '+919876543210', photoURL: null, city: '' }),
}));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
const mockBackend = {
  getWallet: jest.fn(async () => ({ balance: 0, points: 0, wins: 0, potm: 0, matchPoints: 0, bonus: 0, winsToNextBonus: 10, countedMatches: 0, awaitingConfirmation: 0, flagged: 0 })),
  getRankings: jest.fn(async () => ({ ranked: [], total: 0, minMatches: 3, me: null, myCountedMatchIds: [] })),
  watchMyMatches: jest.fn((_u: string, cb: (m: unknown[]) => void) => (cb([]), () => {})),
  watchMyTeams: jest.fn((_u: string, cb: (t: unknown[]) => void) => (cb([]), () => {})),
  listMemories: jest.fn(async () => []),
  confirmResult: jest.fn(async () => undefined),
  rejectResult: jest.fn(async () => undefined),
  reviewMatch: jest.fn(async () => undefined),
  setPlayerOfMatch: jest.fn(async () => undefined),
  listFlaggedMatches: jest.fn(async () => [] as unknown[]),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

const QUICK = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
let ev: MatchEvent[] = [];
ev = addPoint(QUICK, ev, 'A', { at: 1, playerId: 'a2' });
ev = addPoint(QUICK, ev, 'A', { at: 2, playerId: 'a2' });
ev = addPoint(QUICK, ev, 'A', { at: 3, playerId: 'a1' });
const EVENTS = ev;
const mkMatch = (over: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    status: 'finished',
    teamA: { teamId: null, name: 'Delhi Smashers', color: '#D93636', players: [{ id: 'a1', name: 'Aarav' }, { id: 'a2', name: 'Ishaan' }] },
    teamB: { teamId: null, name: 'Yamuna Blockers', color: '#001F4D', players: [{ id: 'b1', name: 'Kavya' }, { id: 'b2', name: 'Meera' }] },
    captains: { A: 'a1', B: 'b1' },
    events: EVENTS,
    summary: summarize(computeState(QUICK, EVENTS, 'A')),
    firstServe: 'A',
    createdBy: 'a1',
    scorerId: 'a1',
    playerOfMatchId: 'a2',
    createdAt: 0,
    startedAt: 0,
    startedServerAt: 0,
    finishedAt: 30 * 60_000,
    finishedServerAt: 30 * 60_000,
    verification: { status: 'pending' },
    rules: QUICK,
    ...over,
  }) as unknown as Match;
const allText = () => JSON.stringify(screen.toJSON());
const count = (s: string) => allText().split(s).length - 1;

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsAdmin = false;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('V138-12: one "Result confirmed by the opposing captain" message', () => {
  const { ResultPanel } = require('../ResultBadge');
  const nameOf = (u: string) => ({ a1: 'Aarav', b1: 'Kavya' })[u];
  it.each(['en', 'hi'])('%s: after confirming, the badge alone says it (no second inline notice)', async (lng) => {
    await i18n.changeLanguage(lng);
    const msg = i18n.t('verify.confirmed');
    expect(msg).toBe(lng === 'en' ? 'Result confirmed by the opposing captain' : 'विरोधी कप्तान ने नतीजे की पुष्टि की');
    expect(i18n.t('verify.confirmedToast')).toBe(msg);
    const view = await render(<ResultPanel match={mkMatch()} meId="b1" isAdmin={false} nameOf={nameOf} />);
    await act(async () => fireEvent.press(screen.getByTestId('confirm-result')));
    // the backend's update arrives: the match is now confirmed
    await view.rerender(<ResultPanel match={mkMatch({ verification: { status: 'confirmed', captain: 'confirmed', by: 'b1', at: 1 } } as Partial<Match>)} meId="b1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('result-confirmed')).toBeTruthy();
    expect(screen.queryByTestId('result-notice')).toBeNull();
    expect(count(msg)).toBe(1);
  });
  // 1.4.1 (V140-12): it is now said from the stored verdict (survives a reload), and still only once
  it('still flagged after confirming: one line says it, from the match itself', async () => {
    const short = { finishedAt: 8 * 60_000, finishedServerAt: 8 * 60_000 } as Partial<Match>;
    const view = await render(<ResultPanel match={mkMatch(short)} meId="b1" isAdmin={false} nameOf={nameOf} />);
    await act(async () => fireEvent.press(screen.getByTestId('confirm-result')));
    await view.rerender(<ResultPanel match={mkMatch({ ...short, verification: { status: 'confirmed', captain: 'confirmed', by: 'b1', at: 1 } } as Partial<Match>)} meId="b1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('result-flagged')).toBeTruthy();
    expect(screen.queryByTestId('result-notice')).toBeNull();
    expect(screen.getByTestId('result-verdict-confirmed')).toHaveTextContent('Result confirmed by the opposing captain');
    expect(count('Result confirmed by the opposing captain')).toBe(1);
  });
});

describe('V138-10 / V138-12: Player of the Match', () => {
  const { PotmBadge, PotmPicker } = require('../Potm');
  it.each(['en', 'hi'])('%s: the label may wrap (2 lines), and the badge says how it was picked', async (lng) => {
    await i18n.changeLanguage(lng);
    await render(<PotmBadge match={mkMatch()} />);
    expect(screen.getByTestId('potm-label').props.numberOfLines).toBe(2);
    expect(screen.getByTestId('potm-basis')).toHaveTextContent(i18n.t('potm.basisAuto'));
    await render(<PotmBadge match={mkMatch({ playerOfMatchId: 'a1' })} />);
    expect(screen.getByTestId('potm-basis')).toHaveTextContent(i18n.t('potm.basisScorer'));
  });
  it('the picker states the rule (most player points, either team; team points don’t count)', async () => {
    await render(<PotmPicker match={mkMatch({ playerOfMatchId: null, finishedAt: Date.now() - 60_000 } as Partial<Match>)} uid="a1" />);
    expect(screen.getByTestId('potm-rule')).toHaveTextContent(/most points credited to a player, from either team\. Team points don’t count/);
  });
});

describe('V138-13: admin links on Profile', () => {
  it.each(['en', 'hi'])('%s: an admin sees Review flagged / Facts / Feedback, each opening its screen', async (lng) => {
    await i18n.changeLanguage(lng);
    mockIsAdmin = true;
    const { router } = require('expo-router');
    const Profile = require('../../app/(tabs)/profile').default;
    await render(<Profile />);
    await act(async () => {});
    expect(screen.getByTestId('profile-admin')).toBeTruthy();
    expect(screen.getByTestId('open-admin')).toHaveTextContent(i18n.t('profile.adminReview'));
    await fireEvent.press(screen.getByTestId('open-admin'));
    await fireEvent.press(screen.getByTestId('open-admin-facts'));
    await fireEvent.press(screen.getByTestId('open-admin-feedback-profile'));
    expect(router.push.mock.calls.map((c: unknown[]) => c[0])).toEqual(['/admin-review', '/admin-daily', '/admin-feedback']);
  });
  it('a non-admin sees none of them', async () => {
    const Profile = require('../../app/(tabs)/profile').default;
    await render(<Profile />);
    await act(async () => {});
    expect(screen.queryByTestId('profile-admin')).toBeNull();
    expect(screen.queryByTestId('open-admin')).toBeNull();
    expect(screen.queryByTestId('open-admin-facts')).toBeNull();
  });
});

describe('V138-14: admin review buttons and Hindi wording', () => {
  const { AdminReviewButtons } = require('../ResultBadge');
  it.each(['en', 'hi'])('%s: short button text with what it does underneath', async (lng) => {
    await i18n.changeLanguage(lng);
    const onApprove = jest.fn();
    await render(<AdminReviewButtons onApprove={onApprove} onVoid={jest.fn()} approveID="ap" voidID="vo" />);
    expect(screen.getByTestId('ap')).toHaveTextContent(lng === 'en' ? 'Approve' : 'मंज़ूर करें');
    expect(screen.getByTestId('vo')).toHaveTextContent(lng === 'en' ? 'Void' : 'अमान्य करें'); // 1.4.8 (V147-5): Void ≠ Cancel
    expect(screen.getByTestId('ap-sub')).toBeTruthy();
    expect(screen.getByTestId('vo-sub')).toHaveTextContent(i18n.t('verify.voidSub'));
    await fireEvent.press(screen.getByTestId('ap'));
    expect(onApprove).toHaveBeenCalled();
  });
  it('Hindi: संस्करण everywhere, the substitution button differs from "Change", no stale review markers', () => {
    const hi = require('../../i18n/locales/hi').default ?? require('../../i18n/locales/hi').hi;
    const flat: string[] = [];
    const walk = (o: unknown) => (typeof o === 'string' ? flat.push(o) : o && typeof o === 'object' ? Object.values(o).forEach(walk) : undefined);
    walk(hi);
    expect(flat.filter((s) => /वर्ज़न|वर्जन/.test(s))).toEqual([]);
    expect(hi.about.version).toBe('संस्करण');
    expect(hi.score.sub).toBe('खिलाड़ी बदलें');
    expect(hi.score.sub).not.toBe(hi.newMatch.change);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../i18n/locales/hi.ts'), 'utf8') as string;
    expect((src.match(/NEEDS REVIEW/g) ?? []).length).toBe(0); // 1.4.0 (V139-6): QA reviewed the last 3
  });
});
