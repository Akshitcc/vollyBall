/**
 * 1.4.6 UI (QA V145): V145-4 (the panel replays score / behind instead of trusting the record), V145-13 (the web
 * keyboard check; the New match footer hides with the keyboard), V145-14 (an abandoned match's admin card: "Abandoned
 * at …" + the reason, EN/HI), V145-15 (one Hindi verb: छोड़ें / मैच बहाल करें), V145-16 (a confirmation before
 * reinstate and before confirming an abandon, EN/HI) and V145-17 (eligible admins for the handoff).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import { addPoint, type MatchEvent } from '../../core/scoring';
import type { Match } from '../../core/types';
import { eligibleHandoffAdmins } from '../../core/scorerHandoff';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockBackend = {
  reportAbandon: jest.fn(async (_m: string) => {}),
  resolveMatch: jest.fn(async (_m: string, _a: string) => {}),
  reviewMatch: jest.fn(async (_m: string, _d: string) => {}),
  answerAbandonRequest: jest.fn(async (_m: string, _a: string) => {}),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
const mockConfirm = jest.fn(async (_msg: string, _o?: unknown) => true);
jest.mock('../../services/dialogs', () => ({ ...jest.requireActual('../../services/dialogs'), confirmAsk: (m: string, o?: unknown) => mockConfirm(m, o) }));

const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} Surname`, photoURL: null }));
const RULES = { ...INDOOR_RULES, bestOf: 3 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1, pointCap: null };
const pts = (sides: string): MatchEvent[] => {
  let ev: MatchEvent[] = [];
  for (const s of sides) ev = addPoint(RULES, ev, s as 'A' | 'B', { at: 1 });
  return ev;
};
const make = (over: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    teamA: { teamId: null, name: 'Delhi Spikers', color: '#D93636', players: players('a') },
    teamB: { teamId: null, name: 'Mumbai Blockers', color: '#2B2B2B', players: players('b') },
    rules: RULES, firstServe: 'A', events: [], status: 'live', createdBy: 'a1', scorerId: 'a1',
    participantIds: [...players('a'), ...players('b')].map((p) => p.id), captains: { A: 'a1', B: 'b1' },
    startedAt: 1, finishedAt: null, updatedAt: 1, createdAt: 1, lineups: null,
    ...over,
  }) as unknown as Match;
const nameOf = (id: string) => (id === 'a1' ? 'Aarav' : id === 'b1' ? 'Bhavna' : undefined);
// set 1 to B 5–2, then 0–3 in set 2 (B leads 1–0 in sets)
const EV = pts('BBABABB' + 'BBB');
const rec = (over: Record<string, unknown> = {}) => ({ by: 'a1', at: 5, events: EV.length, mode: 'review', review: 'pending', behind: false, score: { setsA: 9, setsB: 9, currentA: 9, currentB: 9 }, ...over });
const abandoned = (over: Partial<Match> = {}) => make({ status: 'abandoned', events: EV, maxEvents: EV.length, finishedAt: 5, abandon: rec() as never, ...over });

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('V145-14: the admin card of an abandoned match', () => {
  const { abandonedLine, abandonWhy } = require('../AbandonPanel');
  it.each(['en', 'hi'])('"Abandoned at" the replayed sets + set scores, and why (who, behind, report) – %s', async (lang) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    const m = abandoned({ abandon: rec({ reportedBy: 'b1' }) as never });
    // 1.4.7 (QA V146-7): the current set's points are the score, the sets won come separately
    expect(abandonedLine(m, t)).toBe(lang === 'en' ? 'Abandoned at 0–3 in set 2 · sets 0–1 (2‑5)' : 'सेट 2 में 0–3 पर छोड़ा गया · सेट 0–1 (2‑5)');
    expect(abandonedLine(m, t)).not.toMatch(/sets\s*$/);
    // the record says behind: false and a made-up score – the replay decides (V145-4)
    expect(abandonWhy(m, t, nameOf)).toBe(`${t('verify.whyAbandonedBehind', { name: 'Aarav', team: 'Delhi Spikers' })} · ${t('verify.whyReported', { name: 'Bhavna' })}`);
    if (lang === 'hi') expect(abandonWhy(m, t, nameOf)).toMatch(/[\u0900-\u097F]/);
    // before the first rally / an older app's abandon / an admin's
    expect(abandonedLine(make({ status: 'abandoned' }), t)).toBe(t('verify.abandonedAtNoRally'));
    expect(abandonWhy(abandoned({ abandon: null }), t, nameOf)).toBe(t('verify.whyLegacy'));
    expect(abandonWhy(abandoned({ abandon: rec({ mode: 'admin', by: 'adm', behind: null }) as never }), t, nameOf)).toBe(t('verify.whyAdmin'));
  });
  it('no "no recorded start/finish time" reason and no empty "sets" for an abandoned match', () => {
    const t = i18n.t.bind(i18n);
    expect(abandonWhy(abandoned(), t, nameOf)).not.toContain(t('verify.no_server_times'));
  });
});

describe('V145-4 / V145-16: the abandon panel', () => {
  const { AbandonPanel } = require('../AbandonPanel');
  it('replays the score and the side behind (never the stored record)', async () => {
    await render(<AbandonPanel match={abandoned()} meId="b1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('abandon-panel-by')).toHaveTextContent(i18n.t('abandon.abandonedBy', { name: 'Aarav', score: i18n.t('verify.scoreAt', { a: 0, b: 3, set: 2, sa: 0, sb: 1, done: ' (2\u20115)' }) }));
    expect(screen.getByTestId('abandon-panel-behind')).toHaveTextContent(i18n.t('abandon.sideBehind', { team: 'Delhi Spikers' }));
  });
  it.each(['en', 'hi'])('reinstate and confirm-abandon ask first, saying what happens; "no" does nothing (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<AbandonPanel match={abandoned()} meId="adm" isAdmin nameOf={nameOf} />);
    for (const k of ['reinstate', 'confirm_abandon'] as const) {
      mockConfirm.mockResolvedValueOnce(false);
      await act(async () => {
        fireEvent.press(screen.getByTestId(`resolve-${k}-m1`));
      });
      expect(mockBackend.resolveMatch).not.toHaveBeenCalled();
      expect(mockConfirm).toHaveBeenLastCalledWith(i18n.t(`abandon.confirm.${k}`, { score: i18n.t('verify.scoreAt', { a: 0, b: 3, set: 2, sa: 0, sb: 1, done: ' (2\u20115)' }) }), expect.objectContaining({ title: i18n.t(`abandon.actions.${k}`) }));
      await act(async () => {
        fireEvent.press(screen.getByTestId(`resolve-${k}-m1`));
      });
      expect(mockBackend.resolveMatch).toHaveBeenLastCalledWith('m1', k);
      mockBackend.resolveMatch.mockClear();
    }
  });
});

describe('V145-15: one Hindi verb for abandon', () => {
  it('abandon = छोड़ें / मैच छोड़ें (never रद्द करें); reinstate = मैच बहाल करें', () => {
    const h = hi as unknown as { score: Record<string, string>; abandon: { actions: Record<string, string>; reviewConfirm: string }; matchStatus: Record<string, string> };
    expect(h.score.abandon).toBe('मैच छोड़ें');
    expect(h.score.abandonConfirm).toBe('यह मैच छोड़ें?');
    expect(h.score.abandonYes).toBe('हाँ, मैच छोड़ें');
    expect(h.matchStatus.abandoned).toBe('छोड़ा गया');
    expect(h.abandon.actions.reinstate).toBe('मैच बहाल करें');
    for (const s of [h.score.abandon, h.score.abandonConfirm, h.score.abandonYes, h.score.abandonFailed, h.abandon.reviewConfirm, h.abandon.actions.reinstate]) {
      expect(s).not.toMatch(/रद्द|फिर से शुरू/);
    }
  });
  it('the new keys exist in EN and HI', () => {
    const get = (o: unknown, k: string) => k.split('.').reduce((x: unknown, p) => (x as Record<string, unknown> | undefined)?.[p], o);
    for (const k of ['verify.abandonedAt', 'verify.whyReported', 'abandon.confirm.reinstate', 'abandon.confirm.confirm_abandon', 'match.askAdminTakeover', 'match.handoffAdminChip', 'abandon.handoverHintAsk']) {
      expect([k, typeof get(en, k)]).toEqual([k, 'string']);
      expect([k, typeof get(hi, k)]).toEqual([k, 'string']);
    }
  });
});

describe('V145-13 / V145-17', () => {
  it('web: the keyboard is open when the visual viewport is clearly shorter than the window', () => {
    const { webKeyboardOpen } = require('../KeyboardAwareScreen');
    expect(webKeyboardOpen(800, 790)).toBe(false);
    expect(webKeyboardOpen(800, 450)).toBe(true);
  });
  it('the New match screen hides its footer while the keyboard is open', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/match/new.tsx'), 'utf8');
    expect(src).toMatch(/footer=\{footer\} scrollKey=\{step\} hideFooterOnKeyboard/);
    expect(src).toMatch(/reveal\(resultsRef\.current/);
  });
  it('eligible handoff admins: never the scorer or a verdict captain', () => {
    const m = make({ events: pts('B'), maxEvents: 1 });
    expect(eligibleHandoffAdmins(m, [{ id: 'adm' }, { id: 'b1' }, { id: 'a1' }]).map((x) => x.id)).toEqual(['adm']);
  });
});
