/** Build-217 retest follow-ups, UI side: MiniCourt text colour on the team colour (#5), the
 * tournament team cap in the create screen (#2). */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import MiniCourt from '../MiniCourt';
import { colors, contrast } from '../../theme';
import { MAX_TOURNAMENT_TEAMS } from '../../core/limits';
import i18n from '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() } }));
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true }), useMe: () => ({ id: 'cap', name: 'Cap' }) }));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));
jest.mock('../RulesEditor', () => ({ RulesEditor: () => null }));
const mockTeams = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i}`, name: `Team ${i}`, color: '#D93636', captainId: `c${i}`, memberIds: Array.from({ length: 6 }, (_, j) => `u${i}-${j}`), subIds: [], pendingPhones: [],
}));
jest.mock('../../services/backend', () => ({ backend: { searchTeams: async () => mockTeams, createTournament: jest.fn() } }));

const names = { a: 'Asha Rao', b: 'Bina', c: 'Chitra', d: 'Dev', e: 'Esha', f: 'Farah' };
const textColor = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.children[1].props.style).color;

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('#5 MiniCourt text follows onColor() of the fill', () => {
  it('black on a light team colour, white on a dark one, AA either way', async () => {
    await render(<MiniCourt testID="y" positions={['a', 'b', 'c', 'd', 'e', 'f']} names={names} server={null} screenSide="left" teamName="Yellow" background="#FFD600" />);
    expect(textColor('y-p2')).toBe(colors.ink);
    expect(contrast('#FFD600', colors.ink)).toBeGreaterThanOrEqual(4.5);
    await render(<MiniCourt testID="k" positions={['a', 'b', 'c', 'd', 'e', 'f']} names={names} server={null} screenSide="left" teamName="Dark" background="#2B2B2B" />);
    expect(textColor('k-p2')).toBe(colors.white);
  });
});

describe('#2 tournament create screen stops at the team cap', () => {
  it(`offers no more teams after ${MAX_TOURNAMENT_TEAMS} and says why (EN/HI)`, async () => {
    const NewTournament = require('../../app/tournament/new').default;
    await render(<NewTournament />);
    for (let i = 0; i < MAX_TOURNAMENT_TEAMS; i++) await fireEvent.press(await screen.findByTestId(`add-team-t${i}`, {}, { timeout: 2000 }));
    expect(screen.getByTestId('tournament-full')).toBeTruthy();
    expect(screen.queryByTestId('add-team-t10')).toBeNull();
    expect(screen.getByText(`Teams (${MAX_TOURNAMENT_TEAMS}/${MAX_TOURNAMENT_TEAMS})`)).toBeTruthy();
    await i18n.changeLanguage('hi');
    expect(await screen.findByText(/ज़्यादा से ज़्यादा 10 टीमें/)).toBeTruthy();
  });
});

describe('browser pass #1: tournaments list status (fake clock)', () => {
  it('a future tournament stored as running shows UPCOMING / आगामी, a started one RUNNING', async () => {
    const { backend } = require('../../services/backend');
    const now = Date.parse('2026-10-11T06:00:00Z');
    const base = { organizerId: 'cap', format: 'knockout', rules: {}, location: { name: 'Siri Fort', lat: 1, lng: 1 }, teams: [], fixtures: [], status: 'running', createdAt: 1 };
    backend.watchTournaments = (cb: (t: unknown[]) => void) => {
      cb([
        { ...base, id: 'future', name: 'Diwali Cup', startDate: now + 7 * 86_400_000, endDate: now + 8 * 86_400_000 },
        { ...base, id: 'now', name: 'Monsoon Cup', startDate: now - 3_600_000, endDate: now + 86_400_000 },
      ]);
      return () => {};
    };
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const Tournaments = require('../../app/(tabs)/tournaments').default;
      await render(<Tournaments />);
      expect(screen.getByTestId('tournament-status-future').props.children).toBe('UPCOMING');
      expect(screen.getByTestId('tournament-status-now').props.children).toBe('RUNNING');
      await act(async () => {
        await i18n.changeLanguage('hi');
      });
      expect(screen.getByTestId('tournament-status-future').props.children).toBe('आगामी');
      expect(screen.getByTestId('tournament-status-now').props.children).toBe('जारी');
    } finally {
      jest.useRealTimers();
    }
  });
});
