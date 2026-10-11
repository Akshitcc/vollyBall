import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import i18n from '../../i18n';
import { INDOOR_RULES } from '../../core/rules';
import { defaultLineup } from '../../core/rotation';
import type { Match } from '../../core/types';
import LineupPicker from '../LineupPicker';
import MiniCourt from '../MiniCourt';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const players = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}player${i + 1} Surname`, photoURL: null }));
const match = {
  id: 'm1',
  teamA: { name: 'Delhi Spikers', color: '#E53935', players: players('a', 7) },
  teamB: { name: 'Mumbai Blockers', color: '#2B2B2B', players: players('b', 6) },
  rules: INDOOR_RULES,
  firstServe: 'A',
  events: [],
} as unknown as Match;
const names = Object.fromEntries([...match.teamA.players, ...match.teamB.players].map((p) => [p.id, p.name]));

// Load-safe (fix re-test 213 #2): the LineupPicker (an RN Modal, lazily required) is rendered once
// up front so its module loading isn't timed inside the first test; fake timers, no real waits;
// T is a backstop for a busy CPU.
const T = 15_000;
jest.setTimeout(5_000); // per test, after the warm-up (fix re-test 214 #2); T backstops the warm-up
beforeAll(async () => {
  void require('react-native').Modal;
  const initial = { A: defaultLineup(match.teamA.players.map((p) => p.id)), B: defaultLineup(match.teamB.players.map((p) => p.id)) };
  const warm = await render(<LineupPicker visible match={match} setNumber={1} initial={initial} screenSide={{ A: 'left', B: 'right' }} onSave={() => {}} onClose={() => {}} />);
  await warm.unmount();
  const court = await render(<MiniCourt testID="w" positions={initial.A} names={names} server={null} screenSide="left" teamName="x" />);
  await court.unmount();
}, T);
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  jest.useRealTimers();
});

describe('MiniCourt', () => {
  it('shows first names by position, never captures taps, and highlights the server', async () => {
    await render(<MiniCourt testID="c" positions={defaultLineup(match.teamA.players.map((p) => p.id))} names={names} server="a1" screenSide="left" teamName="Delhi Spikers" />);
    const root = screen.getByTestId('c');
    expect(root.props.pointerEvents).toBe('none');
    expect(screen.getByLabelText('Court positions for Delhi Spikers')).toBeTruthy();
    expect(screen.getByText('Aplayer4')).toBeTruthy(); // first word only, as entered
    const server = StyleSheet.flatten(screen.getByTestId('c-p1').props.style);
    const other = StyleSheet.flatten(screen.getByTestId('c-p2').props.style);
    expect(server.backgroundColor).not.toBe(other.backgroundColor);
  });

  it('uses the Hindi accessibility label in Hindi; names stay as entered', async () => {
    await i18n.changeLanguage('hi');
    await render(<MiniCourt testID="c" positions={['b1', null, null, null, null, null]} names={names} server={null} screenSide="right" teamName="Mumbai Blockers" />);
    expect(screen.getByLabelText('Mumbai Blockers की कोर्ट पोज़ीशन')).toBeTruthy();
    expect(screen.getByText('Bplayer1')).toBeTruthy();
  });
});

describe('LineupPicker', () => {
  it('assigns a bench player to a chosen position and saves', async () => {
    const onSave = jest.fn();
    const initial = { A: defaultLineup(match.teamA.players.map((p) => p.id)), B: defaultLineup(match.teamB.players.map((p) => p.id)) };
    await render(<LineupPicker visible match={match} setNumber={1} initial={initial} screenSide={{ A: 'left', B: 'right' }} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByText('Starting lineup · Set 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lineup-A-p3'));
    await fireEvent.press(screen.getByTestId('lineup-A-player-a7'));
    // swap: a2 moves into position 1 and a1 goes to position 2
    await fireEvent.press(screen.getByTestId('lineup-A-p1'));
    await fireEvent.press(screen.getByTestId('lineup-A-player-a2'));
    await fireEvent.press(screen.getByTestId('lineup-save'));
    expect(onSave).toHaveBeenCalledWith({ A: ['a2', 'a1', 'a7', 'a4', 'a5', 'a6'], B: initial.B });
  });

  it('"Default order" restores the first six players', async () => {
    const onSave = jest.fn();
    const initial = { A: ['a6', 'a5', 'a4', 'a3', 'a2', 'a1'], B: defaultLineup(match.teamB.players.map((p) => p.id)) };
    await render(<LineupPicker visible match={match} setNumber={2} initial={initial} screenSide={{ A: 'right', B: 'left' }} onSave={onSave} onClose={() => {}} />);
    await fireEvent.press(screen.getByText('Default order'));
    await fireEvent.press(screen.getByTestId('lineup-save'));
    expect(onSave.mock.calls[0][0].A).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('needs all 6 positions filled before the lineup can be saved', async () => {
    const onSave = jest.fn();
    const initial = { A: defaultLineup(match.teamA.players.map((p) => p.id)), B: ['b1', 'b2', 'b3', 'b4', 'b5', null] };
    await render(<LineupPicker visible match={match} setNumber={1} initial={initial} screenSide={{ A: 'left', B: 'right' }} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByText('Pick a player for all 6 positions.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lineup-save'));
    expect(onSave).not.toHaveBeenCalled();
  });
});
