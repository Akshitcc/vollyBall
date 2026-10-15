/** The real login screen: switch is visible and flips the whole screen to Hindi and back. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import Login from '../../app/login';
import i18n, { LANGUAGE_STORAGE_KEY } from '../index';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
// Keep Firebase out of the unit test; the screen only needs sendOtp here.
jest.mock('../../services/backend', () => ({ backend: { sendOtp: jest.fn() } }));

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

it('login screen switches between English and हिन्दी', async () => {
  await render(<Login />);
  expect(screen.getByText("Your number is your player ID. We'll text a 6-digit code.")).toBeTruthy(); // 1.4.22 spec v2 *-06 copy
  expect(screen.getByText('Send code')).toBeTruthy();
  expect(screen.getByTestId('language-switch')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('lang-hi'));
  expect(screen.getByText('आपका नंबर ही आपकी प्लेयर ID है। हम 6 अंकों का कोड SMS करेंगे।')).toBeTruthy();
  expect(screen.getByText('कोड भेजें')).toBeTruthy();
  expect(screen.getByText('मोबाइल नंबर')).toBeTruthy();
  expect(screen.queryByText('Send code')).toBeNull();
  expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('hi');

  // validation errors follow the language too
  // (shown inline while typing; Send stays disabled until the number is valid)
  await fireEvent.changeText(screen.getByTestId('phone-input'), '5876543210');
  expect(screen.getByText('मान्य 10 अंकों का मोबाइल नंबर दर्ज करें')).toBeTruthy();
  expect(screen.getByTestId('send-otp').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));

  await fireEvent.press(screen.getByTestId('lang-en'));
  expect(screen.getByText('Send code')).toBeTruthy();
  expect(screen.getByText("Your number is your player ID. We'll text a 6-digit code.")).toBeTruthy(); // 1.4.22 spec v2 *-06 copy
  expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
});

it('QA B4: a send error clears the moment a valid number is typed or pasted', async () => {
  const { backend } = jest.requireMock('../../services/backend') as { backend: { sendOtp: jest.Mock } };
  backend.sendOtp.mockRejectedValueOnce(new Error('auth/invalid-phone-number'));
  await i18n.changeLanguage('en');
  await render(<Login />);
  await fireEvent.changeText(screen.getByTestId('phone-input'), '9876543210');
  await fireEvent.press(screen.getByTestId('send-otp'));
  expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('phone-input'), '987654321');
  await fireEvent.changeText(screen.getByTestId('phone-input'), '+91 98765-43211'); // pasted, valid
  expect(screen.queryByText('Enter a valid 10-digit mobile number')).toBeNull();
  expect(screen.queryByTestId('phone-input-error')).toBeNull();
  expect(screen.getByTestId('send-otp').props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
});
