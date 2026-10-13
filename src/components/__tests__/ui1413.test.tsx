/** 1.4.13 UI: V1412-1 (the off-side captain gets no Confirm and isn't named; 'needs repair' instead), V1412-5 ("Match repaired" survives the card re-mounting, ~4 s), V1412-6 (tied rank wording). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { presetRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockRepair = jest.fn(async () => undefined);
jest.mock('../../services/backend', () => ({ backend: { repairVerdict: (...a: unknown[]) => (mockRepair as (...x: unknown[]) => unknown)(...a), confirmResult: jest.fn(), rejectResult: jest.fn(), reviewMatch: jest.fn() } }));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../services/dialogs', () => ({ confirmAsk: (...a: unknown[]) => (mockConfirm as (...x: unknown[]) => unknown)(...a), notify: jest.fn() }));

import { REPAIRED_MS, VerdictRepairCard, resetRepairedForTests } from '../VerdictRepairCard';
afterEach(() => resetRepairedForTests());

const i18n = require('../../i18n').default;
const WR = { ...presetRules('indoor'), bestOf: 3 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id.toUpperCase() })) });
const match = (points: string, over: Partial<Match> = {}): Match => {
  let ev: Match['events'] = [];
  for (const s of points) ev = addPoint(WR, ev, s as 'A' | 'B', { at: 1 });
  return {
    id: 'm', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' }, createdBy: 'cap', scorerId: 'cap',
    participantIds: [...A, ...B], status: 'abandoned', events: ev, maxEvents: ev.length, startedAt: 1, finishedAt: 2, interestedIds: [], updatedAt: 1, createdAt: 1, ...over,
  } as unknown as Match;
};

import { ResultPanel } from '../ResultBadge';
import { toPassText } from '../rankText';

const capmix = () => match('AAAAAAAAAA', { status: 'finished', captains: { A: 'cap', B: 'a1' }, playerOfMatchId: 'a2', startedAt: 1_000_000, startedServerAt: 1_000_000, finishedAt: 1_000_000 + 65 * 60_000, finishedServerAt: 1_000_000 + 65 * 60_000, verification: { status: 'pending' } } as Partial<Match>);

describe('V1412-1 (UI): captain mix before the repair', () => {
  it.each(['en', 'hi'])('%s: the team-B captain who plays for A (A1) gets no Confirm; nobody is named; "needs repair" shows', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<ResultPanel match={capmix()} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.queryByTestId('confirm-panel')).toBeNull();
    expect(screen.queryByText(i18n.t('verify.waitingFor', { name: 'A1' }))).toBeNull();
    expect(screen.getByTestId('result-needs-repair')).toHaveTextContent(i18n.t('verify.needsRepair'));
  });
  it('after the repair (captain B = b0) b0 gets Confirm and the waiting line names B0', async () => {
    await i18n.changeLanguage('en');
    const fixed = { ...capmix(), captains: { A: 'cap', B: 'b0' } } as Match;
    const r = await render(<ResultPanel match={fixed} meId="b0" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('confirm-panel')).toBeTruthy();
    await r.rerender(<ResultPanel match={fixed} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByText(i18n.t('verify.waitingFor', { name: 'B0' }))).toBeTruthy();
    expect(screen.queryByTestId('result-needs-repair')).toBeNull();
  });
});

describe('V1412-5: "Match repaired" survives a re-mount', () => {
  it.each(['en', 'hi'])('%s: after the repair the page re-mounts the card with the repaired match – the state still shows, then goes after ~4 s', async (lang) => {
    jest.useFakeTimers({ legacyFakeTimers: false, doNotFake: ['nextTick', 'setImmediate'] }); // modern: Date.now moves with the timers
    try {
      await i18n.changeLanguage(lang);
      mockConfirm.mockResolvedValue(true);
      mockRepair.mockResolvedValue(undefined);
      const m = { ...capmix(), id: `rm-${lang}` } as Match;
      const r1 = await render(<VerdictRepairCard match={m} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      await fireEvent.press(screen.getByTestId('verdict-repair-captain-B-b0'));
      expect(await screen.findByTestId('verdict-repair-done')).toHaveTextContent(i18n.t('abandon.repairedToast'));
      await r1.unmount();
      const fixed = { ...m, captains: { A: 'cap', B: 'b0' } } as Match;
      await render(<VerdictRepairCard match={fixed} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      expect(screen.getByTestId('verdict-repair-done')).toHaveTextContent(i18n.t('abandon.repairedToast'));
      await act(async () => { await jest.advanceTimersByTimeAsync(REPAIRED_MS - 1500); });
      expect(screen.getByTestId('verdict-repair-done')).toBeTruthy();
      await act(async () => { await jest.advanceTimersByTimeAsync(2000); });
      expect(screen.queryByTestId('verdict-repair')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('V1412-6: tied rank wording', () => {
  it.each([
    ['en', 'Tied on points with Vihaan (#6) – 1 pt to pass', '9 pts to pass Vihaan (#6)'],
    ['hi', 'Vihaan (#6) के बराबर अंक – आगे निकलने को 1 अंक', 'Vihaan (#6) से आगे निकलने को 9 अंक'],
  ])('%s', async (lang, tied, gap) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    expect(toPassText(t, 53, { rankingPoints: 53, name: 'Vihaan', rank: 6 })).toBe(tied);
    expect(toPassText(t, 44, { rankingPoints: 53, name: 'Vihaan', rank: 6 })).toBe(gap);
    expect(toPassText(t, 53, { rankingPoints: 53, name: 'Vihaan', rank: 6 })).not.toMatch(/\b0\b/);
  });
});

describe('V1413-6 (1.4.14): the status pill says the match needs a repair', () => {
  it.each(['en', 'hi'])('%s', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<ResultPanel match={capmix()} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('result-needs_repair')).toHaveTextContent(i18n.t('verify.needsRepairStatus'));
    expect(screen.queryByText(i18n.t('verify.awaiting_confirmation'))).toBeNull();
  });
  it('after the repair the pill is back to "waiting for the other captain"', async () => {
    await i18n.changeLanguage('en');
    const fixed = { ...capmix(), captains: { A: 'cap', B: 'b0' } } as Match;
    await render(<ResultPanel match={fixed} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('result-awaiting_confirmation')).toHaveTextContent('Waiting for the other captain');
    expect(screen.queryByTestId('result-needs_repair')).toBeNull();
  });
});

describe('V1413-2 (1.4.14): "pt" / "pts" via i18next plurals', () => {
  it.each([
    ['en', '1 pt to pass Vihaan (#6)', '2 pts to pass Vihaan (#6)'],
    ['hi', 'Vihaan (#6) से आगे निकलने को 1 अंक', 'Vihaan (#6) से आगे निकलने को 2 अंक'],
  ])('%s', async (lang, one, two) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    expect(toPassText(t, 52, { rankingPoints: 53, name: 'Vihaan', rank: 6 })).toBe(one);
    expect(toPassText(t, 51, { rankingPoints: 53, name: 'Vihaan', rank: 6 })).toBe(two);
  });
});

describe('V1414-4 (1.4.15): the profile rank card and the Home card say the same (one helper)', () => {
  it.each(['en', 'hi'])('%s: a tie reads "tied … 1 pt to pass", never "0 pts"', async (lang) => {
    await i18n.changeLanguage(lang);
    const { RankCard } = require('../RankCard');
    const row = (id: string, name: string, pts: number, rank: number) => ({ playerId: id, name, rankingPoints: pts, rank, points: 0, wins: 0, potm: 0, matches: 5, winPct: 0 });
    const ranked = [1, 2, 3, 4, 5].map((r) => row(`p${r}`, `P${r}`, 100 - r, r)).concat([row('vihaan', 'Vihaan Gupta', 53, 6), row('priya', 'Priya Nair', 53, 7)]);
    await render(<RankCard rankings={{ ranked, total: 12, me: ranked[6] }} />);
    const t = i18n.t.bind(i18n);
    const want = toPassText(t, 53, ranked[5]);
    expect(screen.getByText(want, { exact: false })).toBeTruthy();
    expect(screen.queryByText(/\b0 (pts|अंक)/)).toBeNull();
  });
});

describe('V1414-5 (1.4.15): the pill depends on who is viewing', () => {
  it.each(['en', 'hi'])('%s: the confirming captain sees "your turn"; others see "waiting"; no captains → not "waiting for the other captain"', async (lang) => {
    await i18n.changeLanguage(lang);
    const fixed = { ...capmix(), captains: { A: 'cap', B: 'b0' } } as Match;
    const r = await render(<ResultPanel match={fixed} meId="b0" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('result-your_turn')).toHaveTextContent(i18n.t('verify.yourTurnStatus'));
    expect(screen.queryByText(i18n.t('verify.awaiting_confirmation'))).toBeNull();
    await r.rerender(<ResultPanel match={fixed} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('result-awaiting_confirmation')).toHaveTextContent(i18n.t('verify.awaiting_confirmation'));
    const none = { ...capmix(), captains: undefined } as unknown as Match;
    await r.rerender(<ResultPanel match={none} meId="a1" isAdmin={false} nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByTestId('result-no_captains')).toHaveTextContent(i18n.t('verify.noCaptainsStatus'));
    expect(screen.queryByText(i18n.t('verify.awaiting_confirmation'))).toBeNull();
  });
});

describe('V1414-3 (1.4.15): "Match repaired" stays ~4 s from when it is SHOWN', () => {
  it.each(['en', 'hi'])('%s: the card re-mounts 1.6 s after the repair returned (page reloading) – still a full ~4 s on screen', async (lang) => {
    jest.useFakeTimers({ legacyFakeTimers: false, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      await i18n.changeLanguage(lang);
      mockConfirm.mockResolvedValue(true);
      let finish: () => void = () => {};
      mockRepair.mockImplementation(() => new Promise<undefined>((r) => (finish = () => r(undefined))));
      const m = { ...capmix(), id: `slow-${lang}` } as Match;
      const r1 = await render(<VerdictRepairCard match={m} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      await fireEvent.press(screen.getByTestId('verdict-repair-captain-B-b0'));
      await r1.unmount(); // the page swaps to its loading state before the call returns
      await act(async () => { finish(); });
      await act(async () => { await jest.advanceTimersByTimeAsync(1600); });
      const fixed = { ...m, captains: { A: 'cap', B: 'b0' } } as Match;
      await render(<VerdictRepairCard match={fixed} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      expect(screen.getByTestId('verdict-repair-done')).toHaveTextContent(i18n.t('abandon.repairedToast'));
      await act(async () => { await jest.advanceTimersByTimeAsync(REPAIRED_MS - 500); });
      expect(screen.getByTestId('verdict-repair-done')).toBeTruthy();
      await act(async () => { await jest.advanceTimersByTimeAsync(800); });
      expect(screen.queryByTestId('verdict-repair')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('V1415-3 (1.4.16): the rank card keeps the number and "pts" / "अंक" together', () => {
  it.each([['en', 'pts'], ['hi', 'अंक']])('%s', async (lang, unit) => {
    await i18n.changeLanguage(lang);
    const { RankCard } = require('../RankCard');
    const row = (id: string, pts: number, rank: number) => ({ playerId: id, name: id, rankingPoints: pts, rank, points: 0, wins: 0, potm: 0, matches: 5, winPct: 0 });
    const ranked = [row('p1', 90, 1), row('me', 53, 2)];
    await render(<RankCard rankings={{ ranked, total: 2, me: ranked[1] }} />);
    const el = screen.getByTestId('profile-rank-pts');
    expect([el.props.children].flat().join('')).toBe(`53\u00a0${unit}`);
    const st = Object.assign({}, ...[el.props.style].flat(3).filter(Boolean));
    expect([st.flexShrink, st.flex, el.props.numberOfLines]).toEqual([0, undefined, 1]);
  });
});
