/** 1.4.12 UI: V1411-4 (the repair card goes after a confirmed repair, no reload) and V1411-5 (the title fits a played and an unplayed match, EN + HI). */
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
jest.mock('../../services/backend', () => ({ backend: { repairVerdict: (...a: unknown[]) => (mockRepair as (...x: unknown[]) => unknown)(...a) } }));
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

describe('V1411-5: repair card title', () => {
  it('EN / HI: "Nobody could confirm this match" – about the match, not a result', () => {
    expect(en.abandon.repairTitle).toBe('Nobody could confirm this match');
    expect(hi.abandon.repairTitle).toBe('इस मैच की पुष्टि कोई नहीं कर पाया');
    expect(hi.abandon.repairTitle).not.toMatch(/नतीज/);
  });
});

describe('V1411-4: the card after a confirmed repair', () => {
  const broken = () => match('AAAAA', { status: 'finished', scorerId: 'b1', playerOfMatchId: 'a1' } as Partial<Match>);
  it.each(['en', 'hi'])('%s: "repaired" replaces title and chips at once, then the card goes when the match updates (no reload)', async (lang) => {
    jest.useFakeTimers();
    try {
      await i18n.changeLanguage(lang);
      mockConfirm.mockResolvedValue(true);
      mockRepair.mockResolvedValue(undefined);
      const r = await render(<VerdictRepairCard match={broken()} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      await fireEvent.press(screen.getByTestId('verdict-repair-scorer-a1'));
      expect(await screen.findByTestId('verdict-repair-done')).toHaveTextContent(i18n.t('abandon.repairedToast'));
      expect(screen.queryByText(i18n.t('abandon.repairTitle'))).toBeNull();
      expect(screen.queryByTestId('verdict-repair-scorer-a1')).toBeNull();
      // the watched match arrives repaired (scorer a1: team B can confirm)
      await r.rerender(<VerdictRepairCard match={{ ...broken(), scorerId: 'a1' } as Match} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
      await act(async () => { jest.advanceTimersByTime(REPAIRED_MS + 10); });
      expect(screen.queryByTestId('verdict-repair')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
