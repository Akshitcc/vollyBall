/**
 * 1.4.15 (QA: web clicks not registering): on web the press target never scales (react-native-web cancels a press that
 * leaves the element's scaled box); native keeps the scale.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform, Text } from 'react-native';
import { PressableScale } from '../PressableScale';

jest.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));

const flat = (s: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(s as never).flat(5).filter(Boolean) as object[]);

describe('PressableScale on web vs native', () => {
  const os = Platform.OS;
  afterEach(() => { (Platform as { OS: string }).OS = os; });
  it.each([['web', false], ['android', true]])('%s: transform used = %s', async (p, scales) => {
    (Platform as { OS: string }).OS = p as string;
    await render(<PressableScale testID="ps" onPress={() => {}}><Text>x</Text></PressableScale>);
    const st = flat(screen.getByTestId('ps').props.style);
    expect(['transform' in st, 'opacity' in st]).toEqual([scales, !scales]);
  });
});

describe('V1414-1 (web): the testing-tool switch row', () => {
  const os = Platform.OS;
  afterEach(() => { (Platform as { OS: string }).OS = os; });
  it('has aria-checked, a described-by hint, and Space toggles it (Enter is the press itself)', async () => {
    const { ToolRow, webSwitchProps } = require('../ToolRow');
    const onChange = jest.fn();
    const w = webSwitchProps(false, 't-hint', onChange);
    expect([w['aria-checked'], w['aria-describedby']]).toEqual([false, 't-hint']);
    const preventDefault = jest.fn();
    w.onKeyDown({ key: ' ', preventDefault });
    w.onKeyDown({ key: 'a', preventDefault });
    expect([onChange.mock.calls, preventDefault.mock.calls.length]).toEqual([[[true]], 1]);
    (Platform as { OS: string }).OS = 'web';
    await render(<ToolRow label="Demo admin" hint="Review flagged matches" value onChange={onChange} testID="t" />);
    expect(screen.getByText('Review flagged matches').props.nativeID).toBe('t-hint');
    expect(screen.getByTestId('t-row').props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe('V1415-2 (web, 1.4.16): the row is the only Tab stop / switch', () => {
  const os = Platform.OS;
  afterEach(() => { (Platform as { OS: string }).OS = os; });
  it('the inner switch input leaves the tab order and the accessibility tree; its wrapper passes taps to the row', async () => {
    const { ToolRow, hideFromWeb } = require('../ToolRow');
    (Platform as { OS: string }).OS = 'web';
    const attrs: Record<string, string> = {};
    const el = { tabIndex: 0, setAttribute: (k: string, v: string) => (attrs[k] = v) };
    hideFromWeb(el);
    expect([el.tabIndex, attrs['aria-hidden']]).toEqual([-1, 'true']);
    const onChange = jest.fn();
    await render(<ToolRow label="Simulate offline" hint="h" value={false} onChange={onChange} testID="t" />);
    expect(screen.getByTestId('t-visual', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
    expect(screen.queryByTestId('t-visual')).toBeNull(); // hidden from the accessibility tree (aria-hidden)
    expect(screen.getByTestId('t-row').props.accessibilityRole ?? screen.getByTestId('t-row').props.role).toBe('switch');
    (Platform as { OS: string }).OS = 'android';
    const el2 = { tabIndex: 0, setAttribute: jest.fn() };
    hideFromWeb(el2);
    expect(el2.setAttribute).not.toHaveBeenCalled(); // native untouched
  });
});
