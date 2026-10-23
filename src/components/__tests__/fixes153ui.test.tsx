/** 1.5.3 UI: F152-4 (invites ending in the same 4 digits get unique labels / testIDs, EN/HI) and F152-3 (fair-play and help copy match the disputed rule). */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';
import { FAQS } from '../../core/helpFaq';
import type { Match, Team } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'team_t1' }) }));
// two invites end in 5678, one in 5607
const mockTeam: Team = { id: 'team_t1', name: 'QA Spikers', color: '#225588', captainId: 'cap', memberIds: ['cap', 'p2', 'p3', 'p4', 'p5', 'p6'], subIds: [], pendingPhones: ['+919812345678', '+919000045607', '+917000005678'], createdAt: 1 } as unknown as Team;
const mockUpdate = jest.fn(async () => {});
jest.mock('../../services/backend', () => ({ backend: { watchTeam: (_id: string, cb: (t: Team) => void) => { cb(mockTeam); return () => {}; }, watchMyMatches: (_u: string, cb: (m: Match[]) => void) => { cb([]); return () => {}; }, updateTeam: (...a: unknown[]) => mockUpdate(...(a as [])) } }));
jest.mock('../../state/AuthContext', () => ({ useMe: () => ({ id: 'cap', profile: { name: 'Cap' } }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}) }));

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
afterEach(async () => { await i18n.changeLanguage('en'); mockUpdate.mockClear(); });

describe.each(['en', 'hi'] as const)('F152-4 invites with the same last 4 digits (%s)', (lang) => {
  it('every withdraw button has a unique label and testID (position), last 4 only, and withdraws the right number', async () => {
    await i18n.changeLanguage(lang);
    const T = i18n.getFixedT(lang);
    const TeamPage = require('../../app/team/[id]').default;
    const r = await render(<ThemeContext.Provider value={ctx('day')}><TeamPage /></ThemeContext.Provider>);
    const b1 = r.getByTestId('team-invite-withdraw-5678-1');
    const b3 = r.getByTestId('team-invite-withdraw-5678-3');
    const b2 = r.getByTestId('team-invite-withdraw-5607'); // unique last 4: unchanged label / testID
    expect(r.queryByTestId('team-invite-withdraw-5678')).toBeNull();
    expect(b1.props.accessibilityLabel).toBe(T('team.withdrawInviteA11yN', { last4: '5678', n: 1, total: 3 }));
    expect(b3.props.accessibilityLabel).toBe(T('team.withdrawInviteA11yN', { last4: '5678', n: 3, total: 3 }));
    expect(b2.props.accessibilityLabel).toBe(T('team.withdrawInviteA11y', { last4: '5607' }));
    const labels = [b1, b2, b3].map((b) => b.props.accessibilityLabel as string);
    expect(new Set(labels).size).toBe(3);
    for (const l of labels) expect(l).not.toMatch(/98123|70000|\+91/);
    for (const b of [b1, b2, b3]) expect(b.props.accessibilityRole).toBe('button');
    fireEvent.press(b3);
    expect(mockUpdate).toHaveBeenCalledWith('team_t1', { pendingPhones: ['+919812345678', '+919000045607'] });
  });
});

describe('F152-4 / F152-3 copy', () => {
  it('EN/HI position label has last4, n, total', () => {
    for (const L of [en, hi] as unknown as { team: Record<string, string> }[]) for (const v of ['{{last4}}', '{{n}}', '{{total}}']) expect(L.team.withdrawInviteA11yN).toContain(v);
  });
  it('fair-play and help never say a disputed result can count after an admin review', () => {
    const T = i18n.getFixedT('en');
    const H = i18n.getFixedT('hi');
    expect(T('terms.fairPlayBody')).toMatch(/rejects is disputed: it doesn't count, and an admin can void it/);
    expect(T('terms.fairPlayBody')).not.toMatch(/disputed results[^.]*until an admin reviews/);
    expect(H('terms.fairPlayBody')).toMatch(/विवादित होता है: वह नहीं गिना जाता, और एडमिन उसे रद्द कर सकता है/);
    const flagged = FAQS.find((f) => f.id === 'flagged')!;
    const disputed = FAQS.find((f) => f.id === 'disputed')!;
    expect(flagged.en.a).not.toMatch(/or disputed\./);
    expect(flagged.en.a).toMatch(/disputed result[^.]*doesn’t count, even if an admin approves/);
    expect(flagged.hi.a).toMatch(/विवादित नतीजा[^।]*नहीं गिना जाता/);
    expect(disputed.en.a).toMatch(/doesn’t count – not even if an admin approves[^.]*\. An admin can void it\./);
    expect(disputed.hi.a).toMatch(/एडमिन उसे रद्द कर सकता है/);
    const confirm = FAQS.find((f) => f.id === 'confirm')!;
    expect(confirm.en.a).toMatch(/rejected result is disputed and doesn’t count/);
    expect(confirm.en.a).not.toMatch(/goes to admin review/);
  });
});
