/**
 * QA B121-8: the add-player mobile field filters to digits as you type (the PhoneInput sanitiser,
 * digitsOnly mode). Letters never appear in the box; a short hint says they were left out.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import { filterPhoneTyping, nextPhoneField } from '../../core/phone';
import { TeamBuilder, type BuiltTeam } from '../TeamBuilder';
import i18n from '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../../services/backend', () => ({ backend: { findUserByPhone: async () => null } }));

const empty = { value: '', display: null };

describe('filterPhoneTyping', () => {
  it('drops letters and symbols, keeps the digits', () => {
    expect(filterPhoneTyping({ value: '98', display: null }, '98a')).toMatchObject({ value: '98', display: null, rejected: false, dropped: true });
    expect(filterPhoneTyping(empty, '98-76x5')).toMatchObject({ value: '98765', rejected: false, dropped: true });
    expect(filterPhoneTyping(empty, 'abc')).toMatchObject({ value: '', display: null, rejected: false, dropped: true });
  });
  it('accepts what the normal sanitiser accepts, unchanged and without the hint', () => {
    for (const raw of ['9876543210', '98765 43210', '+91 98765 43210', '+9']) {
      const a = nextPhoneField(empty, raw);
      expect(filterPhoneTyping(empty, raw)).toEqual({ ...a, dropped: false });
    }
  });
  it('maps Devanagari digits and ignores an 11th digit', () => {
    expect(filterPhoneTyping(empty, '९८७६५४३२१०').value).toBe('9876543210');
    expect(filterPhoneTyping({ value: '9876543210', display: null }, '98765432101')).toMatchObject({ value: '9876543210', rejected: false });
  });
  it('never leaves a letter or symbol in the box; digits that still are not a mobile keep the error', () => {
    for (const raw of ['x', '12ab34', '+1 555 0100 abc', '+44 7700 900123', '!!!', '98765😀']) {
      const n = filterPhoneTyping(empty, raw);
      expect(n.display ?? n.value).toMatch(/^\+?[0-9]*$/);
    }
    expect(filterPhoneTyping(empty, '987654321012')).toMatchObject({ display: '987654321012', rejected: true, dropped: false });
    expect(filterPhoneTyping(empty, '+44 7700 900123')).toMatchObject({ display: '+447700900123', rejected: true, dropped: true });
  });
});

function Harness() {
  const [v, setV] = useState<BuiltTeam>({ kind: 'build', name: 'Sand Kings', color: '#E53935', players: [] });
  return <TeamBuilder value={v} otherPlayerIds={[]} onChange={setV} testID="tb" />;
}

it.each(['en', 'hi'])('TeamBuilder add-player field shows digits only and the hint (%s)', async (lang) => {
  await i18n.changeLanguage(lang);
  await render(<Harness />);
  await fireEvent.changeText(screen.getByTestId('tb-phone'), '98a');
  expect(screen.getByTestId('tb-phone').props.value).toBe('98');
  expect(screen.getByTestId('tb-phone-digits-only')).toHaveTextContent(i18n.t('common.digitsOnly'));
  await fireEvent.changeText(screen.getByTestId('tb-phone'), '987');
  expect(screen.getByTestId('tb-phone').props.value).toBe('987');
  expect(screen.queryByTestId('tb-phone-digits-only')).toBeNull(); // hint clears on a clean keystroke
  await i18n.changeLanguage('en');
});
