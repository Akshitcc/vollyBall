/**
 * PhoneInput behaves the same on web and Android (QA build-217 browser pass #3): the digits never
 * exceed 10 (an extra typed digit is ignored, no error), a paste is cleaned first, and a paste that
 * can't be cleaned to 10 digits stays visible with the error. Typing is simulated keystroke by
 * keystroke (each change = previous text + one character), as both platforms report it.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Platform } from 'react-native';
import i18n from '../../i18n';
import { PhoneInput } from '../PhoneInput';
import { isOneDigitTyped, nextPhoneField } from '../../core/phone';

let lastValue = '';
function Harness() {
  const [v, setV] = useState('');
  lastValue = v;
  return <PhoneInput value={v} onChangeText={setV} testID="ph" />;
}
const input = () => screen.getByTestId('ph');
const shown = () => input().props.value as string;
const error = () => screen.queryByTestId('ph-error');
/** Key presses: each change is the field's current text plus one character at the end. */
async function typeKeys(keys: string) {
  for (const k of keys) await fireEvent.changeText(input(), shown() + k);
}
const paste = (text: string) => fireEvent.changeText(input(), text);

describe('nextPhoneField (pure, used on every platform)', () => {
  test('an 11th typed digit is ignored without an error; a typed digit in the middle too', () => {
    expect(nextPhoneField({ value: '9876543210', display: null }, '98765432101')).toEqual({ value: '9876543210', display: null, rejected: false });
    expect(nextPhoneField({ value: '9876543210', display: null }, '98765143210')).toEqual({ value: '9876543210', display: null, rejected: false });
    expect(isOneDigitTyped('9876543210', '98765432101')).toBe(true);
    expect(isOneDigitTyped('9876543210', '987654321012')).toBe(false); // two characters: a paste
    expect(isOneDigitTyped('9876543210', '9876543210a')).toBe(false);
  });
  test('pastes are cleaned; a paste that can not become 10 digits is shown with the error', () => {
    expect(nextPhoneField({ value: '', display: null }, '+91 98765-43210')).toEqual({ value: '9876543210', display: null, rejected: false });
    expect(nextPhoneField({ value: '', display: null }, '987654321012')).toEqual({ value: '', display: '987654321012', rejected: true });
    expect(nextPhoneField({ value: '98765', display: null }, '98765abc')).toEqual({ value: '98765', display: '98765abc', rejected: true });
  });
});

describe.each(['web', 'android'])('PhoneInput on %s', (os) => {
  const realOS = Platform.OS;
  beforeAll(() => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }));
  afterAll(() => Object.defineProperty(Platform, 'OS', { get: () => realOS, configurable: true }));
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('typing digit by digit never gets past 10 and shows no error', async () => {
    await render(<Harness key={`${os}-1`} />);
    await typeKeys('987654321098765');
    expect(shown()).toBe('9876543210');
    expect(lastValue).toBe('9876543210');
    expect(error()).toBeNull();
    // Devanagari digits from a Hindi keyboard: same limit
    await paste('');
    await typeKeys('९८७६५४३२१०१');
    expect(lastValue).toBe('9876543210');
    expect(error()).toBeNull();
  });

  it('a paste is cleaned first and used when it gives a valid number', async () => {
    await render(<Harness key={`${os}-2`} />);
    await paste('+91 (98765) 43210');
    expect(lastValue).toBe('9876543210');
    expect(shown()).toBe('9876543210');
    await paste('0091 91234-56789');
    expect(lastValue).toBe('9123456789');
    expect(error()).toBeNull();
  });

  it('a paste that cannot be cleaned to 10 digits stays visible with the error (like "abc")', async () => {
    await render(<Harness key={`${os}-3`} />);
    await paste('987654321012');
    expect(shown()).toBe('987654321012');
    expect(error()).toBeTruthy();
    expect(lastValue).toBe('');
    await paste('abc');
    expect(shown()).toBe('abc');
    expect(error()).toBeTruthy();
    await paste('98765 43210');
    expect(shown()).toBe('9876543210');
    expect(error()).toBeNull();
  });
});
