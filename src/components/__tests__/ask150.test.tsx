/** 1.5.0 Ask VolleyLive chat screen + rich cards – EN/HI × Day/Night at 360 px: history, suggestion chips, Clear chat,
 * I don't know + Contact us, cards (scoreboard, standings, stat, fixtures, roster, list) with readable contrast. */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import i18n from '../../i18n';
import { applyTheme, contrast } from '../../theme';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';
import type { AskCard } from '../../core/ask/cards';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }, Stack: { Screen: () => null } }));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../services/dialogs', () => ({ confirmAsk: (...a: unknown[]) => (mockConfirm as (...x: unknown[]) => Promise<boolean>)(...a) }));
const mockChat = jest.fn();
const mockHistory = jest.fn(async (): Promise<unknown[]> => []);
const mockClear = jest.fn(async () => undefined);
jest.mock('../../services/backend', () => ({ backend: { askChat: (q: string, l: string) => mockChat(q, l), askHistory: () => mockHistory(), clearAskHistory: () => mockClear() } }));

const LONG = 'Goregaon Giants Volleyball Club Under-21';
export const CARDS: AskCard[] = [
  { type: 'scoreboard', matchId: 'm1', status: 'live', teamA: { name: LONG, color: '#001F4D' }, teamB: { name: 'Yamuna Blockers', color: '#E53935' }, setsA: 1, setsB: 1, currentA: 19, currentB: 17, sets: [[25, 20], [18, 25]], winner: null },
  { type: 'standings', tournamentId: 'T', title: 'Juhu Groups Cup', group: 'A', champion: 'Juhu T02', rows: [1, 2, 3, 4].map((i) => ({ pos: i, teamId: `t${i}`, name: i === 1 ? LONG : `Juhu T0${i}`, color: '#001F4D', played: 3, won: 4 - i, lost: i - 1, setsWon: 6, setsLost: 2, points: 9 - i, q: i <= 2 })) },
  { type: 'stat', playerId: 'p1', name: 'Priya Gupta', mine: false, rank: 2, matches: 3, wins: 2, winPct: 67, rankingPoints: 93, potm: 2 },
  { type: 'fixtures', title: 'Fixtures', items: [{ id: 'f1', matchId: 'm2', label: 'Final', home: LONG, away: 'Juhu T03', status: 'finished', setsA: 2, setsB: 1, when: 1_760_000_000_000 }, { id: 'f2', label: 'SF', home: 'Juhu T01', away: 'Juhu T05', status: 'open' }] },
  { type: 'roster', teamId: 'tb', name: 'Yamuna Blockers', color: '#E53935', players: [{ id: 'a', name: 'Priya Nair', captain: true, sub: false }, { id: 'b', name: 'Rohan Mehta', captain: false, sub: true }] },
  { type: 'list', kind: 'leaderboard', items: [{ id: 'x1', title: '#1 Aarav Sharma', value: '104' }, { id: 'x2', title: '#2 Priya Gupta', value: '93', mine: true }] },
];
const item = (id: string, question: string, extra: Record<string, unknown> = {}) => ({ id, at: 1, question, lang: 'en', answer: `Answer to ${question}`, sources: [], idk: false, cards: [], outcome: 'answer', refusal: null, tools: [], ...extra });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const ctxOf = (theme: 'day' | 'night') => ({ name: theme, t: tokens[theme], setting: theme, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 });

type Node = { type: string; props: Record<string, any>; children: (Node | string)[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Every text colour vs the nearest painted background above it (WCAG AA 4.5:1 for these ≤14 px texts). */
function contrastFailures(tree: Node | Node[] | null, bg: string): string[] {
  const out: string[] = [];
  const walk = (n: Node | string, under: string) => {
    if (typeof n === 'string') return;
    const s = (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, string>;
    const paint = typeof s.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.backgroundColor) ? s.backgroundColor : under;
    if (n.type === 'Text' && typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color)) {
      const r = contrast(s.color, paint);
      if (r < 4.5) out.push(`${JSON.stringify(n.children?.filter((c) => typeof c === 'string').join(''))} ${s.color} on ${paint} = ${r.toFixed(2)}`);
    }
    for (const c of n.children ?? []) walk(c, paint);
  };
  for (const n of Array.isArray(tree) ? tree : tree ? [tree] : []) walk(n, bg);
  return out;
}

afterEach(async () => { applyTheme('day'); await i18n.changeLanguage('en'); jest.clearAllMocks(); });

describe.each([['en', 'day'], ['en', 'night'], ['hi', 'day'], ['hi', 'night']] as const)('%s / %s', (lang, theme) => {
  const T = (k: string, o?: object) => i18n.getFixedT(lang)(k, o as never) as unknown as string;
  async function show(node: React.ReactElement) {
    applyTheme(theme);
    await i18n.changeLanguage(lang);
    const r = await render(<ThemeContext.Provider value={ctxOf(theme) as never}>{node}</ThemeContext.Provider>);
    await settle();
    return r;
  }
  it('all six cards render at 360 px: long names wrap (2 lines), numbers stay in narrow columns, AA contrast', async () => {
    const { AskCards } = require('../ask/AskCards');
    const r = await show(<AskCards cards={CARDS} testID="cards" />);
    for (const id of ['ask-card-scoreboard-m1', 'ask-card-standings-T-A', 'ask-card-stat-p1', 'ask-card-fixtures', 'ask-card-roster-tb', 'ask-card-list-leaderboard']) expect(r.getByTestId(id)).toBeTruthy();
    expect(r.getByTestId('ask-card-champion-T')).toBeTruthy();
    for (const n of r.getAllByText(LONG)) expect(n.props.numberOfLines).toBe(2);
    // a standings row: name flexes, the fixed numeric columns fit a 360 px phone with the screen + card padding
    const row = r.getByTestId('ask-standings-row-t1');
    const fixed = (row.children as unknown as { props: { style: unknown } }[]).map((c) => (StyleSheet.flatten(c.props?.style as never) ?? {}) as { width?: number }).reduce((a, s) => a + (typeof s.width === 'number' ? s.width : 0), 0);
    expect(fixed).toBeLessThanOrEqual(360 - 2 * 16 - 2 * 10 - 120);
    expect(contrastFailures(r.toJSON() as never, tokens[theme].bg)).toEqual([]);
  });
  it('a card opens its screen (match / tournament / team)', async () => {
    const { AskCards } = require('../ask/AskCards');
    const r = await show(<AskCards cards={CARDS} testID="cards" />);
    await fireEvent.press(r.getByTestId('ask-card-scoreboard-m1'));
    await fireEvent.press(r.getByTestId('ask-card-standings-T-A'));
    await fireEvent.press(r.getByTestId('ask-card-roster-tb'));
    expect(mockPush.mock.calls.map((c) => c[0])).toEqual(['/match/m1', '/tournament/T', '/team/tb']);
  });
  it('history loads; a suggestion chip asks; cards show under the answer; Clear chat asks first', async () => {
    mockHistory.mockResolvedValueOnce([item('7', 'my teams', { cards: [CARDS[5]] })]);
    mockChat.mockImplementation(async (q: string) => item('8', q, { cards: [CARDS[0]], tools: [{ name: 'live_score' }] }));
    const AskScreen = require('../../app/ask').default;
    const r = await show(<AskScreen />);
    expect(r.getByTestId('ask-intro')).toBeTruthy();
    expect(r.getByText(new RegExp(T('ask.readOnly').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(r.getByTestId('ask-answer-h7')).toBeTruthy();
    expect(r.getByTestId('ask-card-list-leaderboard')).toBeTruthy();
    for (const k of ['stats', 'next', 'live', 'teams', 'leaderboard', 'rules']) expect(r.getByTestId(`ask-suggest-${k}`)).toBeTruthy();
    await fireEvent.press(r.getByTestId('ask-suggest-live'));
    await settle();
    expect(mockChat).toHaveBeenCalledWith(T('ask.suggestions.live'), lang);
    expect(r.getByTestId('ask-card-scoreboard-m1')).toBeTruthy();
    expect(contrastFailures(r.toJSON() as never, tokens[theme].bg)).toEqual([]);
    await fireEvent.press(r.getByTestId('ask-clear'));
    await settle();
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalled();
    expect(r.queryByTestId('ask-answer-h7')).toBeNull();
  });
  it("Clear chat cancelled keeps history; I don't know offers Contact us; errors are translated", async () => {
    mockHistory.mockResolvedValueOnce([item('1', 'old')]);
    mockConfirm.mockResolvedValueOnce(false);
    mockChat.mockImplementationOnce(async (q: string) => item('2', q, { idk: true, outcome: 'idk', answer: '' }));
    mockChat.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: 'rate_limited', retryAfter: 30 }); });
    const AskScreen = require('../../app/ask').default;
    const r = await show(<AskScreen />);
    await fireEvent.press(r.getByTestId('ask-clear'));
    await settle();
    expect(mockClear).not.toHaveBeenCalled();
    expect(r.getByTestId('ask-answer-h1')).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('ask-input'), 'bitcoin price today');
    await fireEvent.press(r.getByTestId('ask-send'));
    await settle();
    await fireEvent.press(r.getByTestId('ask-contact-n1'));
    expect(mockPush).toHaveBeenCalledWith('/contact');
    await fireEvent.changeText(r.getByTestId('ask-input'), 'what is a libero');
    await fireEvent.press(r.getByTestId('ask-send'));
    await settle();
    expect(r.getByText(T('errors.codes.rate_limited', { seconds: 30 }))).toBeTruthy();
  });
  it('history that fails to load says so and the chat still works', async () => {
    mockHistory.mockRejectedValueOnce(new Error('offline'));
    const AskScreen = require('../../app/ask').default;
    const r = await show(<AskScreen />);
    expect(r.getByTestId('ask-history-error')).toBeTruthy();
    expect(r.getByTestId('ask-input')).toBeTruthy();
  });
});
