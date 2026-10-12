/**
 * 1.4.3 UI: V142-8 (the Edit-profile pincode lookup shows Hindi place names in Hindi), V142-5 (the email
 * allow-list message under the field, EN + HI).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import type { UserProfile } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
let mockProfile: Partial<UserProfile> | null = null;
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1', phoneNumber: '+919812345678' }, profile: mockProfile, isAdmin: false }), useMe: () => ({ id: 'u1', name: 'U' }) }));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
const mockSave = jest.fn(async (_p: UserProfile): Promise<void> => {});
const PINS: Record<string, { status: string; district?: string; state?: string }> = {
  '110001': { status: 'ok', district: 'New Delhi', state: 'Delhi' },
  '400001': { status: 'ok', district: 'Mumbai', state: 'Maharashtra' },
  '560001': { status: 'ok', district: 'Nowhere Rural', state: 'Karnataka' },
};
jest.mock('../../services/backend', () => ({ backend: { saveProfile: (p: UserProfile) => mockSave(p), lookupPincode: async (p: string) => PINS[p] ?? { status: 'unknown' }, uploadAvatar: jest.fn() } }));

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const { ProfileForm } = require('../ProfileForm');
const base = { id: 'u1', name: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', pincode: '', phone: '+919812345678' };
beforeEach(async () => {
  jest.clearAllMocks();
  mockProfile = { ...base };
  await i18n.changeLanguage('en');
});
afterAll(async () => i18n.changeLanguage('en'));

describe('V142-8: Edit profile – the pincode lookup in Hindi', () => {
  it.each([
    ['110001', 'नई दिल्ली, दिल्ली', 'New Delhi, Delhi'],
    ['400001', 'मुंबई, महाराष्ट्र', 'Mumbai, Maharashtra'],
  ])('%s → %s (HI) / %s (EN)', async (pin, hi, en) => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    const r = await render(<ProfileForm />);
    await fireEvent.changeText(screen.getByTestId('profile-pincode'), pin);
    await flush();
    await flush();
    expect(screen.getByTestId('profile-pincode-result')).toHaveTextContent(hi);
    expect(screen.getByTestId('profile-pincode-result')).not.toHaveTextContent(/[A-Za-z]/);
    await r.unmount();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await render(<ProfileForm />);
    await fireEvent.changeText(screen.getByTestId('profile-pincode'), pin);
    await flush();
    await flush();
    expect(screen.getByTestId('profile-pincode-result')).toHaveTextContent(en);
  });
  it('a district without a Hindi name: only the state in Hindi, never English', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await render(<ProfileForm />);
    await fireEvent.changeText(screen.getByTestId('profile-pincode'), '560001');
    await flush();
    await flush();
    expect(screen.getByTestId('profile-pincode-result')).not.toHaveTextContent(/[A-Za-z]/);
    expect(screen.getByTestId('profile-pincode-result')).toHaveTextContent('कर्नाटक'); // exactly the state
  });
});

describe('V142-5: an address outside the allow list gets its own message under the field', () => {
  it.each([
    ['en', 'This address has a character we can’t accept'],
    ['hi', 'इस पते में ऐसा अक्षर है जो हम नहीं ले सकते'],
  ])('%s', async (lng, msg) => {
    mockProfile = { ...base, pincode: '110001' };
    await act(async () => {
      await i18n.changeLanguage(lng);
    });
    await render(<ProfileForm />);
    await fireEvent.changeText(screen.getByTestId('profile-email'), 'a\uFFF9b@x.in');
    await flush();
    await fireEvent.press(screen.getByText(i18n.t('profileForm.save')));
    await flush();
    expect(screen.getByTestId('profile-email-error')).toHaveTextContent(new RegExp(`^${msg}`));
    expect(mockSave).not.toHaveBeenCalled();
  });
});
