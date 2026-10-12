/**
 * 1.4.2 UI: V141-9 (the review prompt after the result sheet is closed on the scoring screen; a flagged short
 * match is no exception), V141-10 (Hindi setup tab), info (language toggles are buttons).
 */
import { act, render } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import i18n from '../../i18n';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false) } }));
const mockAsk = jest.fn(async (_o: unknown) => undefined);
jest.mock('../../services/review', () => ({ maybeAskForReview: (o: unknown) => mockAsk(o) }));
jest.mock('../../services/backend', () => ({
  backend: {
    watchMyMatches: (_uid: string, cb: (m: unknown[]) => void) => {
      cb([{ status: 'finished' }, { status: 'finished' }, { status: 'finished' }]);
      return () => undefined;
    },
  },
}));

const base = {
  id: 'm1', status: 'live', title: null, events: [], createdAt: Date.UTC(2026, 9, 1), updatedAt: 0, scorerId: 'u1', createdBy: 'u1',
  teamA: { name: 'Smashers', color: '#123456', players: [{ id: 'u1', name: 'Me' }] },
  teamB: { name: 'Blockers', color: '#654321', players: [{ id: 'u3', name: 'Them' }] },
  summary: { setsA: 0, setsB: 0, currentA: 0, currentB: 0, setScores: [], winner: null, serving: 'A' },
} as unknown as Match;
const won = (over: Partial<Match> = {}) => ({ ...base, status: 'finished', finishedAt: Date.now(), summary: { ...base.summary, setsA: 1, winner: 'A', setScores: [{ a: 25, b: 10 }] }, ...over }) as Match;

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});
afterEach(() => jest.useRealTimers());
const tick = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

describe('V141-9: the review prompt on the scoring screen, once the result sheet is closed', () => {
  const { useReviewPrompt } = require('../../state/useReviewPrompt');
  const { Modal } = require('../AppModal');
  /** The scoring screen's wiring (score.tsx): the hook sees the match only when it is over and the sheet is closed. */
  function Score({ match, overClosed }: { match: Match; overClosed: boolean }) {
    useReviewPrompt(match && match.status === 'finished' && overClosed ? match : null, 'u1');
    return (
      <Modal visible={match.status === 'finished' && !overClosed} transparent>
        <Text>result sheet</Text>
      </Modal>
    );
  }
  it('score.tsx wires it exactly like this', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/match/[id]/score.tsx'), 'utf8');
    expect(src).toContain("useReviewPrompt(match && match.status === 'finished' && overClosed ? match : null, me.id);");
  });
  it('nothing while rallies are scored or the sheet is open; after Close (Escape / back / backdrop) it asks after the pause', async () => {
    jest.useFakeTimers();
    const r = await render(<Score match={base} overClosed={false} />);
    await r.rerender(<Score match={won()} overClosed={false} />);
    await tick(10_000);
    expect(mockAsk).not.toHaveBeenCalled();
    await r.rerender(<Score match={won()} overClosed />);
    await tick(1600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(mockAsk.mock.calls[0][0]).toMatchObject({ uid: 'u1', moment: 'won', liveScoring: false, completedMatches: 3 });
  });
  it('a flagged short match (finished 8 min after the start) asks too – being flagged is no exception', async () => {
    jest.useFakeTimers();
    const now = Date.now();
    const short = won({ startedAt: now - 8 * 60_000, finishedAt: now, finishedServerAt: now } as Partial<Match>);
    const r = await render(<Score match={short} overClosed={false} />);
    await r.rerender(<Score match={short} overClosed />);
    await tick(1600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });
  it('the sheet closed more than 10 minutes after the finish: not asked (as on the match page)', async () => {
    jest.useFakeTimers();
    const old = won({ finishedAt: Date.now() - 11 * 60_000 } as Partial<Match>);
    const r = await render(<Score match={old} overClosed={false} />);
    await r.rerender(<Score match={old} overClosed />);
    await tick(5000);
    expect(mockAsk).not.toHaveBeenCalled();
  });
});

describe('V141-10 / info: Hindi setup tab label and language toggles', () => {
  it('the setup tab label says खिलाड़ी (players) and has room for Devanagari matras (padding, taller line, 2 lines)', () => {
    expect(i18n.t('newMatch.buildTeam', { lng: 'hi' })).toBe('नंबर से खिलाड़ी जोड़ें');
    expect(i18n.t('newMatch.buildTeam', { lng: 'hi' })).not.toContain('खाड़ी');
    const src = fs.readFileSync(path.join(__dirname, '../../app/match/new.tsx'), 'utf8');
    expect(src).toMatch(/fontSize: 13, lineHeight: 19, paddingHorizontal: 3, flexShrink: 1, minWidth: 0, textAlign: 'center' \}\} numberOfLines=\{2\}/);
  });
  it('English / हिन्दी are buttons with a pressed state', async () => {
    const { LanguageSwitch } = require('../LanguageSwitch');
    const v = await render(<LanguageSwitch />);
    const en = v.getByTestId('lang-en');
    expect(en.props.accessibilityRole).toBe('button');
    expect(en.props['aria-pressed']).toBe(true);
    expect(v.getByTestId('lang-hi').props['aria-pressed']).toBe(false);
  });
});
