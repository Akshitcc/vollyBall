/** 1.5.2 UI: F151-7 (pending-invite remove button has an accessible label, EN/HI) and F151-3 (result copy matches the rules). */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';
import { resultStatus } from '../../core/resultStatus';
import { teamRecord } from '../../core/teamRecord';
import type { Match, Team } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'team_t1' }) }));
const mockTeam: Team = { id: 'team_t1', name: 'QA Spikers', color: '#225588', captainId: 'cap', memberIds: ['cap', 'p2', 'p3', 'p4', 'p5', 'p6'], subIds: [], pendingPhones: ['+919812345678', '+919000045607'], createdAt: 1 } as unknown as Team;
const mockUpdate = jest.fn(async () => {});
jest.mock('../../services/backend', () => ({ backend: { watchTeam: (_id: string, cb: (t: Team) => void) => { cb(mockTeam); return () => {}; }, watchMyMatches: (_u: string, cb: (m: Match[]) => void) => { cb([]); return () => {}; }, updateTeam: (...a: unknown[]) => mockUpdate(...(a as [])) } }));
jest.mock('../../state/AuthContext', () => ({ useMe: () => ({ id: 'cap', profile: { name: 'Cap' } }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}) }));

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
afterEach(async () => { await i18n.changeLanguage('en'); mockUpdate.mockClear(); });

describe.each(['en', 'hi'] as const)('F151-7 pending-invite remove button (%s)', (lang) => {
  it('has a role, a label naming the invite (last 4 digits only) and still withdraws it', async () => {
    await i18n.changeLanguage(lang);
    const TeamPage = require('../../app/team/[id]').default;
    const r = await render(<ThemeContext.Provider value={ctx('day')}><TeamPage /></ThemeContext.Provider>);
    const b = r.getByTestId('team-invite-withdraw-5678');
    expect(b.props.accessibilityRole).toBe('button');
    expect(b.props.accessibilityLabel).toBe(i18n.getFixedT(lang)('team.withdrawInviteA11y', { last4: '5678' }));
    expect(b.props.accessibilityLabel).toContain('5678');
    expect(b.props.accessibilityLabel).not.toMatch(/98123|\+91/); // never the full number
    expect(r.getByLabelText(i18n.getFixedT(lang)('team.withdrawInviteA11y', { last4: '5607' }))).toBeTruthy();
    fireEvent.press(b);
    expect(mockUpdate).toHaveBeenCalledWith('team_t1', { pendingPhones: ['+919000045607'] });
  });
});

describe('F151-7 copy', () => {
  it('EN/HI', () => {
    expect((en as any).team.withdrawInviteA11y).toMatch(/\{\{last4\}\}/); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((hi as any).team.withdrawInviteA11y).toMatch(/\{\{last4\}\}.*[\u0900-\u097F]/); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

// a finished match: A won 2-0, long enough, POTM picked; overrides per state
const base = (o: Record<string, unknown> = {}) => ({
  id: 'm1', status: 'finished', teamA: { teamId: 'tA', name: 'A', players: [] }, teamB: { teamId: 'tB', name: 'B', players: [] }, createdBy: 'capA', scorerId: 'capA', captains: { A: 'capA', B: 'capB' },
  summary: { winner: 'A', setsA: 2, setsB: 0 }, winner: 'A', startedServerAt: 0, finishedServerAt: 45 * 60_000, playerOfMatchId: 'p1', events: [], ...o,
}) as unknown as Match;
const SHORT = { finishedServerAt: 5 * 60_000 }; // < 10 min → too_short flag

describe('F151-3 result states match the rules', () => {
  it('flagged (too short) and the other captain has NOT confirmed → reviewAwaiting (both shown)', () => {
    expect(resultStatus(base({ ...SHORT, verification: { status: 'pending' } }))).toBe('reviewAwaiting');
    // admin approves the flag first: still waiting for the captain
    expect(resultStatus(base({ ...SHORT, verification: { status: 'approved' } }))).toBe('awaiting');
  });
  it('flagged and the other captain confirmed → review (counts once an admin approves – true)', () => {
    expect(resultStatus(base({ ...SHORT, verification: { status: 'confirmed', captain: 'confirmed', by: 'capB' } }))).toBe('review');
  });
  it('rejected stays disputed even after an admin approve (approved_rejected) – it never counts', () => {
    const m = base({ verification: { status: 'approved', captain: 'rejected', by: 'capB' } });
    const st = resultStatus(m);
    expect(st).toBe('disputed');
    expect(teamRecord('tA', [m])).toMatchObject({ played: 0, disputed: 1 });
  });
  it('team page shows the reviewAwaiting line; copy never promises an admin approve counts a disputed result', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../app/team/[id].tsx'), 'utf8') as string;
    expect(src).toContain('testID="team-stats-review-awaiting">{t(\'dn.reviewAwaitingResults\', { count: rec.reviewAwaiting })}');
    for (const L of [en, hi] as unknown as { dn: Record<string, string>; ask: { card: { result: Record<string, string> } } }[]) {
      for (const f of ['_one', '_other']) expect(L.dn['reviewAwaitingResults' + f]).toMatch(/\{\{count\}\}/);
      expect(L.ask.card.result.reviewAwaiting).toBeTruthy();
    }
    const T = i18n.getFixedT('en');
    expect(T('dn.disputedResults', { count: 1 })).toBe("1 result was rejected by the other captain – it doesn't count. An admin can void it.");
    expect(T('dn.disputedResults', { count: 1 })).not.toMatch(/approve/);
    expect(T('dn.reviewAwaitingResults', { count: 2 })).toBe('2 results are waiting for the other captain to confirm and for an admin review.');
    expect(i18n.getFixedT('hi')('dn.disputedResults', { count: 1 })).not.toMatch(/मंज़ूरी/);
    expect(T('ask.card.result.reviewAwaiting')).toMatch(/other captain.*admin review/);
  });
});
