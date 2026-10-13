/**
 * 1.4.18: V1417-1 (Enter during the lookup queues the add), V1417-2 (the "N more players" space is kept at 6),
 * V1417-3 (the box is cleared synchronously), V1416-3 (RevealOnFocus works from the screen component; the place name
 * reveals itself when it appears), V1416-5 (the Testing tools heading is a tap target on web).
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Platform, TextInput } from 'react-native';
import { TeamBuilder, type BuiltTeam } from '../TeamBuilder';
import { RevealOnFocus, ScrollRevealContext } from '../KeyboardAwareScreen';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
const mockLookups: string[] = [];
let mockRelease: (() => void) | null = null;
jest.mock('../../services/backend', () => ({
  backend: {
    findUserByPhone: (n: string) => {
      mockLookups.push(n);
      return new Promise((res) => { mockRelease = () => res({ id: `u${n.slice(-2)}`, name: `Player ${n.slice(-2)}`, photoURL: null }); });
    },
  },
}));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

function Harness({ start = 0 }: { start?: number }) {
  const [v, setV] = useState<BuiltTeam>({ kind: 'build', name: 'QA', color: '#E53935', players: Array.from({ length: start }, (_, i) => ({ id: `p${i}`, name: `P${i}`, photoURL: null })) });
  return <TeamBuilder value={v} onChange={setV} otherPlayerIds={[]} testID="side-a" max={12} />;
}
const tick = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => { mockLookups.length = 0; mockRelease = null; });

describe('V1417-1: Enter while the lookup is running', () => {
  it('queues the add and runs it once the lookup resolves – one lookup, one add', async () => {
    const s = await render(<Harness />);
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '9000000011');
    await tick(400); // the lookup has started (debounce 350 ms) and is pending
    expect(mockLookups).toEqual(['+919000000011']);
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    expect(s.queryByText('Player 11')).toBeNull();
    await act(async () => { mockRelease!(); });
    await tick(10);
    expect(s.getByText('Player 11')).toBeTruthy();
    expect(s.getAllByText('Player 11')).toHaveLength(1);
    expect(mockLookups).toHaveLength(1); // not looked up again
    expect(s.getByTestId('side-a-phone').props.value).toBe('');
  });
  it('a new number typed after Enter drops the queued add', async () => {
    const s = await render(<Harness />);
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '9000000011');
    await tick(400);
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    const first = mockRelease!;
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '900000001');
    await act(async () => { first(); });
    await tick(10);
    expect(s.queryByText('Player 11')).toBeNull();
  });
});

describe('V1417-2 / V1417-3: adding the 6th player', () => {
  it('keeps the warning space (same height) and clears the box synchronously', async () => {
    const clear = jest.spyOn(TextInput.prototype as unknown as { clear: () => void }, 'clear');
    const s = await render(<Harness start={5} />);
    await fireEvent(s.getByTestId('side-a-need'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 21 } } });
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '9000000016');
    await tick(400);
    await act(async () => { mockRelease!(); });
    await tick(10);
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    expect(s.queryByTestId('side-a-need')).toBeNull();
    const sp = s.getByTestId('side-a-need-space', { includeHiddenElements: true });
    const st = Object.assign({}, ...[sp.props.style].flat().filter(Boolean));
    expect([st.height, st.marginVertical]).toEqual([21, 4]);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe('V1416-3: RevealOnFocus', () => {
  it('reveals from inside the provider even when the screen component renders it', async () => {
    const reveal = jest.fn();
    const s = await render(
      <ScrollRevealContext.Provider value={reveal}>
        <RevealOnFocus testID="box">{(onFocus) => <TextInput testID="title" onFocus={onFocus} />}</RevealOnFocus>
      </ScrollRevealContext.Provider>,
    );
    await fireEvent(s.getByTestId('title'), 'focus');
    await tick(950);
    expect(reveal.mock.calls.length).toBe(3);
    expect(reveal.mock.calls.every(([n, b]) => n != null && b === 24)).toBe(true);
  });
  it('the New match title uses RevealOnFocus; the place name is revealed when it appears', () => {
    const fs = require('fs'); const path = require('path');
    const nm = fs.readFileSync(path.join(__dirname, '../../app/match/new.tsx'), 'utf8');
    expect(nm).toMatch(/<RevealOnFocus testID="match-title-box">/);
    expect(nm).not.toMatch(/useFocusReveal\(\)/);
    const lp = fs.readFileSync(path.join(__dirname, '../LocationPicker.tsx'), 'utf8');
    expect(lp).toMatch(/<RevealOnShow show=\{!!value\}/);
  });
});

describe('V1416-5: the heading is a tap target on web', () => {
  it('tapTargetOnWeb sets tabindex -1 on web only', () => {
    const { tapTargetOnWeb } = require('../DemoQaTools');
    const el = { setAttribute: jest.fn() };
    tapTargetOnWeb(el);
    expect(el.setAttribute).not.toHaveBeenCalled();
    const os = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    tapTargetOnWeb(el);
    (Platform as { OS: string }).OS = os;
    expect(el.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
  });
});
