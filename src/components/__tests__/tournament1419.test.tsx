/** 1.4.19: tournament page – the owner sees the edit / delete controls; everyone else a 'View only' label (EN / HI). */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import type { Tournament } from '../../core/types';
import i18n from '../../i18n';
import TournamentPage from '../../app/tournament/[id]';

let mockMe = 'own';
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
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: mockMe === 'adm', termsOk: true, user: { uid: mockMe } }), useMe: () => ({ id: mockMe, name: 'Me' }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}), useProfile: () => null }));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../services/dialogs', () => ({ confirmAsk: (...a: unknown[]) => mockConfirm(...(a as [])), notify: jest.fn() }));
let mockT: Tournament;
const mockDelete = jest.fn(async () => {});
const mockUpdate = jest.fn(async () => {});
jest.mock('../../services/backend', () => ({
  backend: {
    watchTournament: (_id: string, cb: (t: Tournament) => void) => { setTimeout(() => cb(mockT), 0); return () => {}; },
    watchTournamentMatches: (_id: string, cb: (m: unknown[]) => void) => { setTimeout(() => cb([]), 0); return () => {}; },
    watchTeam: () => () => {},
    updateTournament: (...a: unknown[]) => mockUpdate(...(a as [])),
    deleteTournament: (...a: unknown[]) => mockDelete(...(a as [])),
    createMatch: jest.fn(),
  },
}));

const tour = (over: Partial<Tournament> = {}): Tournament => ({
  id: 'T', name: 'Delhi Cup', organizerId: 'own', format: 'knockout', rules: INDOOR_RULES, startDate: Date.now() + 86400000, endDate: Date.now() + 2 * 86400000,
  location: { name: 'Siri Fort', lat: 28.55, lng: 77.22 }, teams: [{ id: 't1', name: 'Spikers', color: '#D93636' }, { id: 't2', name: 'Blockers', color: '#001F4D' }],
  fixtures: [{ id: 'f1', round: 1, homeId: 't1', awayId: 't2' } as never], status: 'registration', createdAt: 1, ...over,
}) as Tournament;

async function show(me: string, lang: 'en' | 'hi', over: Partial<Tournament> = {}) {
  mockMe = me;
  mockT = tour(over);
  await i18n.changeLanguage(lang);
  const r = await render(<TournamentPage />);
  await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
  return r;
}
afterEach(async () => { await i18n.changeLanguage('en'); jest.clearAllMocks(); });

describe.each(['en', 'hi'] as const)('%s', (lang) => {
  const T = (k: string) => i18n.getFixedT(lang)(k);
  it('owner: delete + start controls, no View only label', async () => {
    const r = await show('own', lang);
    expect(r.queryByTestId('tournament-view-only', { includeHiddenElements: true })).toBeNull();
    expect(r.queryByText(`👁 ${T('tournament.viewOnly')}`)).toBeNull();
    expect(r.getByTestId('tournament-delete')).toBeTruthy();
    expect(r.getByText(T('tournament.delete'))).toBeTruthy();
    expect(r.getByText(T('tournament.tapToStart'))).toBeTruthy();
    expect(r.getByText(T('tournament.organiserBanner'))).toBeTruthy();
  });
  for (const who of ['stranger', 'adm']) {
    it(`${who}: View only label, no edit / delete / start controls`, async () => {
      const r = await show(who, lang);
      expect(r.getByTestId('tournament-view-only')).toBeTruthy();
      expect(r.getByText(`👁 ${T('tournament.viewOnly')}`)).toBeTruthy();
      expect(r.getByText(T('tournament.viewOnlyHint'))).toBeTruthy();
      expect(r.queryByTestId('tournament-delete', { includeHiddenElements: true })).toBeNull();
      expect(r.queryByText(T('tournament.tapToStart'))).toBeNull();
      expect(r.queryByText(T('tournament.organiserBanner'))).toBeNull();
      expect(r.getByText('Spikers')).toBeTruthy(); // still sees the bracket
    });
  }
  it('an older tournament without an owner: View only for everyone', async () => {
    const r = await show('own', lang, { organizerId: undefined as never });
    expect(r.getByTestId('tournament-view-only')).toBeTruthy();
    expect(r.queryByTestId('tournament-delete', { includeHiddenElements: true })).toBeNull();
  });
});

it('owner delete asks first, then deletes', async () => {
  const r = await show('own', 'en');
  mockConfirm.mockResolvedValueOnce(false);
  await fireEvent.press(r.getByTestId('tournament-delete'));
  expect(mockDelete).not.toHaveBeenCalled();
  await fireEvent.press(r.getByTestId('tournament-delete'));
  expect(mockConfirm).toHaveBeenCalledTimes(2);
  expect(mockDelete).toHaveBeenCalledWith('T');
});
it('HI view-only text differs from EN', () => {
  expect(i18n.getFixedT('hi')('tournament.viewOnly')).not.toBe(i18n.getFixedT('en')('tournament.viewOnly'));
});
