// 1.4.24 (QA V1423-3): Night contrast follow-ups.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { applyTheme, colors, contrast, swatchRing } from '../../theme';
import { Button, Chip, chipActiveFill, TeamDot } from '../ui';
import { DobPicker, DOB_ROW_H } from '../DobPicker';

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
afterEach(() => { jest.useRealTimers(); applyTheme('day'); });

test('navy team dot gets a light ring on the Night card; light colours none', () => {
  applyTheme('night');
  expect(swatchRing('#001F4D')).toEqual({ borderWidth: 2, borderColor: colors.text });
  expect(contrast(colors.text, '#151B2E')).toBeGreaterThan(3);
  expect(swatchRing('#2DD4F0')).toBeNull();
});

test.each(['day', 'night'] as const)('disabled Button (New match Next path) meets AA in %s', async (th) => {
  applyTheme(th);
  const r = await render(<Button title="Next: Rules" disabled testID="next-rules" onPress={() => {}} />);
  const txt = r.getByText('Next: Rules');
  expect(contrast(String(flat(txt).color), colors.disabledBg)).toBeGreaterThanOrEqual(4.5);
});

test('selected chip without a colour is clearly marked in Night (25 km)', async () => {
  applyTheme('night');
  expect(chipActiveFill()).toBe(colors.primary);
  const r = await render(<Chip label="25 km" active onPress={() => {}} />);
  expect(contrast(String(flat(r.getByText('25 km')).color), colors.primary)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(colors.primary, colors.bg)).toBeGreaterThanOrEqual(3); // the selected fill stands out from the page
});

test.each(['day', 'night'] as const)('DOB picker: selection marked (✓, primary fill, outline) and scrolled into view (%s)', async (th) => {
  applyTheme(th);
  jest.useFakeTimers();
  const spy = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: () => void }, 'scrollTo').mockImplementation(() => {});
  const r = await render(<DobPicker value="1990-07-15" onChange={() => {}} minAge={13} label="DOB" testID="dob" />);
  await fireEvent.press(r.getByTestId('dob'));
  await act(async () => { jest.runOnlyPendingTimers(); });
  const day = r.getByTestId('dob-day-15');
  expect(flat(day).backgroundColor).toBe(colors.primary);
  expect(flat(day).borderColor).toBe(colors.text);
  expect(Math.max(contrast(colors.primary, colors.card), contrast(colors.text, colors.card))).toBeGreaterThanOrEqual(3); // fill or outline marks it (non-text 3:1)
  expect(r.getByText('✓ 15')).toBeTruthy();
  expect(r.getByText('✓ 1990')).toBeTruthy();
  // three columns scrolled so the selected row is in the middle (day 15 → row 14)
  const ys = spy.mock.calls.map((c) => (c as unknown as [{ y: number }])[0].y);
  expect(ys).toContain(14 * DOB_ROW_H - 130 + DOB_ROW_H / 2);
  expect(ys.length).toBeGreaterThanOrEqual(3);
  spy.mockRestore();
});

test('TeamDot renders the ring', async () => {
  applyTheme('night');
  const r = await render(<TeamDot color="#001F4D" testID="d" />);
  expect(flat(r.getByTestId('d')).borderColor).toBe(colors.text);
});
