/** 1.4.21 spec v2 §3 components in both themes: segmented control, step dots, reaction button, sheet scrim. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { ReactionButton, SegmentedControl, SheetScrim, StepDots } from '../DayNightKit';
import { THEME_KEY, ThemeProvider } from '../../theme/ThemeProvider';
import { contrast, tokens } from '../../theme';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const flat = (x: unknown) => StyleSheet.flatten(x as never) as Record<string, unknown>;

describe.each(['day', 'night'] as const)('%s', (name) => {
  const t = tokens[name];
  const wrap = async (ui: React.ReactElement) => {
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ setting: name }));
    const r = await render(<ThemeProvider uid={null}>{() => ui}</ThemeProvider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return r;
  };
  it('segmented control: selected colours per spec, AA, onChange', async () => {
    const on = jest.fn();
    const r = await wrap(<SegmentedControl testID="seg" value="table" onChange={on} items={[{ key: 'table', label: 'Table' }, { key: 'bracket', label: 'Bracket' }, { key: 'fixtures', label: 'Fixtures' }]} />);
    const sel = flat(r.getByTestId('seg-table').props.style);
    expect(sel.backgroundColor).toBe(name === 'day' ? t.text : t.primary);
    const label = flat(r.getByText('Table').props.style);
    expect(contrast(label.color as string, sel.backgroundColor as string)).toBeGreaterThanOrEqual(4.5);
    expect(r.getByTestId('seg-table').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(r.getByTestId('seg-fixtures'));
    expect(on).toHaveBeenCalledWith('fixtures');
  });
  it('step dots: done / current (28 wide) / todo', async () => {
    const r = await wrap(<StepDots testID="dots" step={1} total={4} />);
    expect(r.getAllByTestId('dots-done')).toHaveLength(1);
    expect(flat(r.getByTestId('dots-current').props.style).width).toBe(28);
    expect(r.getAllByTestId('dots-todo')).toHaveLength(2);
  });
  it('reaction button: 48 circle, sends and shows +1', async () => {
    const on = jest.fn();
    const r = await wrap(<ReactionButton testID="react-fire" emoji="🔥" label="Fire" onPress={on} />);
    expect(flat(r.getByTestId('react-fire').props.style).width).toBe(48);
    await fireEvent.press(r.getByTestId('react-fire'));
    expect(on).toHaveBeenCalled();
    expect(r.getByTestId('react-fire-sent')).toBeTruthy();
  });
  it('sheet scrim per theme', async () => {
    const r = await wrap(<SheetScrim testID="scrim" />);
    expect(flat(r.getByTestId('scrim', { includeHiddenElements: true }).props.style).backgroundColor).toBe(name === 'day' ? 'rgba(27,19,64,0.55)' : 'rgba(3,5,12,0.72)');
  });
});
