import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import i18n from '../../i18n';
import { PhoneInput, PASTE_ROOM } from '../PhoneInput';
import { Button } from '../ui';
import { isValidMobile } from '../../core/phone';

let lastValue = '';
function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [v, setV] = useState('');
  lastValue = v;
  return (
    <>
      <PhoneInput
        value={v}
        onChangeText={(n) => {
          setV(n);
          onValue?.(n);
        }}
        label="Mobile number"
        testID="ph"
      />
      <Button title="Continue" disabled={!isValidMobile(v)} testID="go" />
    </>
  );
}

const input = () => screen.getByTestId('ph');
const type = (s: string) => fireEvent.changeText(input(), s);
const disabled = () => !!screen.getByTestId('go').props.accessibilityState?.disabled;

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

it('shows a fixed +91 prefix that is not part of the editable value', async () => {
  await render(<Harness />);
  expect(screen.getByTestId('ph-prefix').props.children.join('')).toBe('+91');
  expect(input().props.value).toBe('');
  expect(input().props.keyboardType).toBe('number-pad');
});

it('N1: maxLength stays 20 even when full, so a paste over a full field is cleaned, and the value never exceeds 10 digits', async () => {
  await render(<Harness />);
  expect(PASTE_ROOM).toBe(20);
  expect(input().props.maxLength).toBe(PASTE_ROOM); // room for a pasted "+91 (98765) 43210"
  await type('9876543210');
  expect(input().props.maxLength).toBe(PASTE_ROOM);
  await type('+91 (98765) 43210'); // pasted over the selected full field
  expect(lastValue).toBe('9876543210');
  expect(input().props.value).toBe('9876543210');
  expect(screen.queryByTestId('ph-error')).toBeNull();
  await type('+91 (91234) 56789');
  expect(lastValue).toBe('9123456789');
  await type('98765432101'); // an 11-digit paste over the field: refused, shown with the error
  expect(lastValue).toBe('9123456789');
  expect(screen.getByTestId('ph-error')).toBeTruthy();
});

it('N3: a partly typed +, +9, +91 shows no error and completes normally', async () => {
  await render(<Harness />);
  for (const partial of ['+', '+9', '+91', '+91 ']) {
    await type(partial);
    expect(input().props.value).toBe(partial); // shown as typed
    expect(screen.queryByTestId('ph-error')).toBeNull();
    expect(lastValue).toBe('');
  }
  await type('+91 9');
  expect(input().props.value).toBe('9');
  expect(lastValue).toBe('9');
  await type('9876543210');
  expect(lastValue).toBe('9876543210');
  expect(disabled()).toBe(false);
  expect(screen.queryByTestId('ph-error')).toBeNull();
});

it('"abc" stays visible with the error instead of leaving a silently empty field', async () => {
  await render(<Harness />);
  await type('abc');
  expect(input().props.value).toBe('abc');
  expect(lastValue).toBe('');
  expect(screen.getByTestId('ph-error')).toBeTruthy();
  await type(''); // cleared: no error
  expect(screen.queryByTestId('ph-error')).toBeNull();
});

it('cleans pasted numbers', async () => {
  await render(<Harness />);
  for (const [paste, out] of [
    ['+91 98765-43210', '9876543210'],
    ['098765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['0091 98765 43210', '9876543210'],
    ['९८७६५४३२१०', '9876543210'],
  ]) {
    await type('');
    await type(paste);
    expect(input().props.value).toBe(out);
  }
});

it('letters, emoji, full-width digits and other country codes are refused and flagged, not stripped', async () => {
  await render(<Harness />);
  await type('98765');
  for (const bad of ['98765abc43210', '98765😀', '９８７６５４３２１０', '+1 4155552671']) {
    await type(bad);
    expect(lastValue).toBe('98765'); // value unchanged
    expect(input().props.value).toBe(bad); // the refused text stays visible next to the error
    expect(screen.getByTestId('ph-error')).toBeTruthy();
    expect(disabled()).toBe(true);
  }
});

it('submit is enabled only for a valid number; error shown while typing an invalid one (EN)', async () => {
  await render(<Harness />);
  expect(disabled()).toBe(true);
  expect(screen.queryByTestId('ph-error')).toBeNull(); // untouched: no error
  await type('5876543210');
  expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeTruthy();
  expect(disabled()).toBe(true);
  await type('987654321');
  expect(screen.getByTestId('ph-error')).toBeTruthy();
  expect(disabled()).toBe(true);
  await type('9876543210');
  expect(screen.queryByTestId('ph-error')).toBeNull();
  expect(disabled()).toBe(false);
  await type('');
  expect(screen.queryByTestId('ph-error')).toBeNull(); // cleared field: no error flash
});

it('error is translated (HI)', async () => {
  await i18n.changeLanguage('hi');
  await render(<Harness />);
  await type('12345');
  expect(screen.getByText('मान्य 10 अंकों का मोबाइल नंबर दर्ज करें')).toBeTruthy();
});
