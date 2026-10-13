/**
 * 1.4.17: V1416-3 (shared focus reveal on the New match inputs), V1416-4 (Enter adds the found player; focus goes back to
 * the phone field; the builder keeps its height after an add) and V1416-5 (Testing tools heading apart from the rows).
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { TeamBuilder, type BuiltTeam } from '../TeamBuilder';
import { FOCUS_REVEAL_MS, ScrollRevealContext, useFocusReveal } from '../KeyboardAwareScreen';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../../services/backend', () => ({
  backend: { findUserByPhone: async (n: string) => ({ id: `u${n.slice(-2)}`, name: `Player ${n.slice(-2)}`, photoURL: null }) },
}));

function Harness({ reveal = () => {}, max = 12 }: { reveal?: (n: unknown, b?: number) => void; max?: number }) {
  const [v, setV] = useState<BuiltTeam>({ kind: 'build', name: 'QA', color: '#E53935', players: [] });
  return (
    <ScrollRevealContext.Provider value={reveal}>
      <TeamBuilder value={v} onChange={setV} otherPlayerIds={[]} testID="side-a" max={max} />
    </ScrollRevealContext.Provider>
  );
}
const layout = (h: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: h } } });

afterEach(() => jest.useRealTimers());

describe('V1416-3: useFocusReveal (shared scroll-into-view on focus)', () => {
  it('reveals the wrapped box at 60 and 400 ms after focus, with no keyboard event', async () => {
    const reveal = jest.fn();
    let api: ReturnType<typeof useFocusReveal> | null = null;
    function P() { api = useFocusReveal(); return <View ref={api.ref} collapsable={false}><TextInput testID="f" onFocus={api.onFocus} /></View>; }
    const s = await render(<ScrollRevealContext.Provider value={reveal}><P /></ScrollRevealContext.Provider>);
    jest.useFakeTimers();
    await fireEvent(s.getByTestId('f'), 'focus');
    await act(async () => { jest.advanceTimersByTime(FOCUS_REVEAL_MS[1] + 10); });
    expect(reveal).toHaveBeenCalledTimes(2);
    expect(reveal.mock.calls[0][1]).toBe(24);
    jest.useRealTimers();
  });
  it('the team name and the +91 phone field on New match reveal themselves when focused', async () => {
    const reveal = jest.fn();
    const s = await render(<Harness reveal={reveal} />);
    jest.useFakeTimers();
    await fireEvent(s.getByTestId('side-a-phone'), 'focus');
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(reveal.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(reveal.mock.calls.some(([n]) => n != null)).toBe(true);
    reveal.mockClear();
    await fireEvent(s.getByTestId('side-a-name'), 'focus');
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(reveal.mock.calls.length).toBeGreaterThanOrEqual(2);
    jest.useRealTimers();
  });
});

describe('V1416-4: Enter adds the found player; the layout holds', () => {
  it('Enter / Done adds, clears the field, keeps the keyboard (blurOnSubmit false) and the builder height', async () => {
    const s = await render(<Harness />);
    const root = s.getByTestId('side-a');
    await fireEvent(root, 'layout', layout(640));
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '9000000011');
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(s.getByTestId('side-a-found')).toBeTruthy();
    expect(s.getByTestId('side-a-phone').props.blurOnSubmit).toBe(false);
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    expect(s.queryByTestId('side-a-found')).toBeNull();
    expect(s.getByText('Player 11')).toBeTruthy();
    expect(s.getByTestId('side-a-phone').props.value).toBe('');
    const st = Object.assign({}, ...[s.getByTestId('side-a').props.style].flat().filter(Boolean));
    expect(st.minHeight).toBe(640); // what's below (the captain control) doesn't move up under the finger
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '9');
    const st2 = Object.assign({}, ...[s.getByTestId('side-a').props.style].flat().filter(Boolean));
    expect(st2.minHeight).toBeUndefined(); // typing the next number releases it
  });
  it('Enter with nothing found (or a refusal) adds nothing', async () => {
    const s = await render(<Harness />);
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    expect(s.getByTestId('side-a-need')).toBeTruthy();
    expect(s.queryByText(/^Player \d/)).toBeNull();
    expect(s.getByText('Players: 0/12')).toBeTruthy();
  });
});

describe('V1416-5: the Testing tools heading is apart from the switch rows', () => {
  it('heading has a bottom margin and is a header, not a target', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../DemoQaTools.tsx'), 'utf8');
    const i = src.indexOf('testID="demo-qa-tools-heading"');
    const line = src.slice(src.lastIndexOf('<Text', i), src.indexOf('</Text>', i));
    expect(line).toMatch(/paddingBottom: 10/); // 1.4.19 (V1416-5): padding – the gap is part of the heading's tap area
    expect(line).toMatch(/accessibilityRole="header"/);
    expect(line).not.toMatch(/onPress/);
  });
});
