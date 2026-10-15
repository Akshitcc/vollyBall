// 1.4.23: V1422-6 (dialogs readable in Night) and V1422-4 (Night contrast on the reported screens).
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
import { act, render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { applyTheme, contrast, teamText } from '../../theme';
import { tokens } from '../../theme/tokens';
import { DialogHost } from '../DialogHost';
import { openDialog, closeDialog } from '../../state/dialog';
import { LanguageSwitch } from '../LanguageSwitch';
import { KButton } from '../DNKit';
import { ThemeContext } from '../../theme/ThemeProvider';
const ctxBase = { setting: 'auto', animate: false, setSetting: () => {}, setAnimate: () => {} };

const hex = (c: unknown) => String(c).toUpperCase();
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
afterEach(async () => { await act(async () => closeDialog(false)); applyTheme('day'); });
void act;

describe.each(['day', 'night'] as const)('DialogHost in %s (V1422-6)', (th) => {
  test('card, title, message and every button reach AA', async () => {
    applyTheme(th);
    const T = tokens[th];
    void openDialog({ title: 'Abandon match', message: 'Abandon this match?', buttons: [{ text: 'Keep playing', style: 'cancel', value: false }, { text: 'Abandon', style: 'destructive', value: true }, { text: 'OK', value: true }] });
    const screen = await render(<DialogHost />);
    const card = flat(screen.getByTestId('app-dialog'));
    expect(hex(card.backgroundColor)).toBe(T.surface.toUpperCase());
    for (const id of ['app-dialog-title', 'app-dialog-message']) expect(contrast(String(flat(screen.getByTestId(id)).color), T.surface)).toBeGreaterThanOrEqual(4.5);
    // cancel (outline on the card), destructive (onLive on live), default (onPrimary on primary)
    expect(contrast(String(flat(screen.getByTestId('app-dialog-btn-text-0')).color), T.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(String(flat(screen.getByTestId('app-dialog-btn-text-1')).color), T.live)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(String(flat(screen.getByTestId('app-dialog-btn-text-2')).color), T.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Night contrast fixes (V1422-4)', () => {
  test('team colours are lightened on the Night card, darkened on Day white', () => {
    applyTheme('night');
    for (const c of ['#001F4D', '#D93636', '#0B6E6A', '#000000']) expect(contrast(teamText(c), '#151B2E')).toBeGreaterThanOrEqual(4.5);
    applyTheme('day');
    for (const c of ['#001F4D', '#FFC531', '#FFFFFF']) expect(contrast(teamText(c), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
  test('LanguageSwitch chips readable in Night (Profile + Login HI chip)', async () => {
    applyTheme('night');
    const screen = await render(<LanguageSwitch />);
    // the unselected HI chip sits on the Night background (was ink #0F1424 on navy: 1.05:1)
    const hiChip = screen.getByText('हिन्दी');
    expect(contrast(String(flat(hiChip).color), tokens.night.bg)).toBeGreaterThanOrEqual(4.5);
  });
  test.each(['day', 'night'] as const)('disabled KButton text stays readable (%s)', async (th) => {
    applyTheme(th);
    const screen = await render(<ThemeContext.Provider value={{ ...ctxBase, name: th, t: tokens[th] } as never}><KButton title="Next" disabled testID="nb" /></ThemeContext.Provider>);
    const T = tokens[th];
    const txt = screen.getByText('Next');
    expect(contrast(String(flat(txt).color), T.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(flat(screen.getByTestId('nb')).opacity ?? 1).toBe(1);
  });
});
