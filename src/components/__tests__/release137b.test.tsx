/**
 * 1.3.7 browser-pass items: inline field errors + focus (R136-15), current values saved and the demo /
 * API pincode wording (R136-16), digits-only and length notes (R136-17), letters-only (R136-18), the
 * Hindi oblique case and month names (R136-21), the substitution sheet and untitled live card (R136-20),
 * and the profile form in API mode (server field errors shown under the field).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import type { Match, UserProfile } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() }, Redirect: ({ href }: { href: string }) => require('react').createElement(require('react-native').Text, { testID: 'redirect' }, href) }));
let mockProfile: Partial<UserProfile> | null = null;
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1', phoneNumber: '+919812345678' }, profile: mockProfile, isAdmin: false }), useMe: () => ({ id: 'u1', name: 'U' }) }));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
const mockSave = jest.fn(async (_p: UserProfile): Promise<void> => {});
const mockLookup = jest.fn(async (pin: string) => (pin === '110001' ? { status: 'ok', district: 'New Delhi', state: 'Delhi' } : pin === '999999' ? { status: 'invalid' } : { status: 'unknown' }));
jest.mock('../../services/backend', () => ({ backend: { saveProfile: (p: UserProfile) => mockSave(p), lookupPincode: (p: string) => mockLookup(p), uploadAvatar: jest.fn() } }));

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
beforeEach(async () => {
  jest.clearAllMocks();
  mockProfile = null;
  await i18n.changeLanguage('en');
});

describe('ProfileForm (R136-15..18)', () => {
  const { ProfileForm } = require('../ProfileForm');
  const fill = async (v: Record<string, string>) => {
    for (const [k, val] of Object.entries(v)) await fireEvent.changeText(screen.getByTestId(`profile-${k}`), val);
    await flush();
  };
  it('Save shows every problem under its own field (red, aria-invalid) and focuses the first; nothing saved', async () => {
    await render(<ProfileForm />);
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(screen.getByTestId('profile-first-name-error')).toHaveTextContent('First name is required.');
    expect(screen.getByTestId('profile-last-name-error')).toHaveTextContent('Last name is required.');
    expect(screen.getByTestId('profile-dob-error')).toBeTruthy();
    expect(screen.getByTestId('profile-pincode-error')).toHaveTextContent('Pincode is required.');
    expect(screen.getByTestId('profile-first-name').props['aria-invalid']).toBe(true);
    expect(screen.getByTestId('profile-email').props['aria-invalid']).toBe(false);
    expect(screen.queryByTestId('profile-error')).toBeNull(); // no single line above Save any more
    expect(mockSave).not.toHaveBeenCalled();
    // fixing a field clears its error live
    await fill({ 'first-name': 'Asha' });
    expect(screen.queryByTestId('profile-first-name-error')).toBeNull();
  });
  it('emoji → letters only; at 40 letters a note; non-digits in the pincode say digits only', async () => {
    await render(<ProfileForm />);
    await fireEvent.changeText(screen.getByTestId('profile-pincode'), '11a');
    expect(screen.getByTestId('profile-pincode-hint')).toHaveTextContent('Pincode can only have digits 0–9.');
    expect(screen.getByTestId('profile-pincode').props.value).toBe('11');
    await fill({ 'first-name': '😀' });
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(screen.getByTestId('profile-first-name-error')).toHaveTextContent('First name can only have letters, spaces, apostrophes and hyphens.');
    await fill({ 'last-name': 'a'.repeat(40) });
    expect(screen.getByTestId('profile-last-name-hint')).toHaveTextContent('Maximum 40 letters reached.');
  });
  it('R136-16: what is on screen is what gets validated / saved (012345 is refused, then 400001 saved)', async () => {
    mockProfile = { id: 'u1', name: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', pincode: '110001', phone: '+919812345678', district: 'New Delhi', state: 'Delhi' };
    await render(<ProfileForm />);
    await fill({ pincode: '012345' });
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(screen.getByTestId('profile-pincode-error')).toHaveTextContent(/^Pincode must be 6 digits/);
    expect(mockSave).not.toHaveBeenCalled();
    await fill({ pincode: '400001' });
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({ pincode: '400001', district: null, state: null });
    expect(screen.getByTestId('profile-pincode-result')).toHaveTextContent(/^Couldn’t verify this pincode/);
  });
  it('a definitively invalid pin (999999) is refused under the field, same words in demo and API', async () => {
    mockProfile = { id: 'u1', name: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', pincode: '110001', phone: '+919812345678' };
    await render(<ProfileForm />);
    await fill({ pincode: '999999' });
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(screen.getByTestId('profile-pincode-error')).toHaveTextContent(/^No post office has this pincode/);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('API mode: a server field error (email_taken) is shown under that field, not above Save', async () => {
    mockProfile = { id: 'u1', name: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', pincode: '110001', phone: '+919812345678' };
    mockSave.mockRejectedValueOnce(Object.assign(new Error('Invalid request: email – taken'), { code: 'email_taken', field: 'email' }));
    await render(<ProfileForm />);
    await fill({ email: 'a@b.co' });
    await fireEvent.press(screen.getByText('Save profile'));
    await flush();
    expect(screen.getByTestId('profile-email-error')).toHaveTextContent('This email is already used by another account.');
    expect(screen.queryByTestId('profile-error')).toBeNull();
  });
  it('Hindi: "पहले नाम में" (oblique case), full month names, DOB label like the other labels', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    mockProfile = { id: 'u1', name: 'A', firstName: 'A', lastName: 'Rao', dob: '2000-09-05', pincode: '110001', phone: '+919812345678' };
    await render(<ProfileForm />);
    await fill({ 'first-name': 'A1' });
    await fireEvent.press(screen.getByText('प्रोफ़ाइल सेव करें'));
    await flush();
    expect(screen.getByTestId('profile-first-name-error')).toHaveTextContent(/^पहले नाम में/);
    expect(screen.getByTestId('profile-dob')).toHaveTextContent('5 सितंबर 2000');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByTestId('profile-dob')).toHaveTextContent('5 September 2000');
  });
});

describe('R136-20', () => {
  it('Sub sheet: bench player takes the court player’s position', async () => {
    const { SubSheet, substitute } = require('../SubSheet');
    const l = { A: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], B: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'] };
    expect(substitute(l, 'A', 'a3', 'a7').A).toEqual(['a1', 'a2', 'a7', 'a4', 'a5', 'a6']);
    expect(substitute(l, 'A', 'a3', 'a2')).toBe(l); // already on court
    const players = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} X` }));
    const match = { teamA: { name: 'Giants', color: '#6A1B9A', players: players('a', 8) }, teamB: { name: 'B', color: '#001F4D', players: players('b', 6) } } as unknown as Match;
    const onSave = jest.fn();
    await render(<SubSheet visible match={match} setNumber={1} initial={l} onSave={onSave} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('sub-off-a3'));
    await fireEvent.press(screen.getByTestId('sub-on-a8'));
    await fireEvent.press(screen.getByTestId('sub-make'));
    expect(screen.getByTestId('sub-made-0')).toHaveTextContent(/Giants: A8 X on for A3 X/);
    await fireEvent.press(screen.getByTestId('sub-save'));
    expect(onSave.mock.calls[0][0].A).toEqual(['a1', 'a2', 'a8', 'a4', 'a5', 'a6']);
    await fireEvent.press(screen.getByTestId('sub-team-B'));
    expect(screen.getByTestId('sub-no-bench')).toBeTruthy();
  });
  it('an untitled live match card reads "Team A vs Team B · Set 1"', async () => {
    const { LiveMatchCard } = require('../MatchCard');
    const m = { id: 'm1', title: '', status: 'live', teamA: { name: 'Delhi Smashers', color: '#D93636', players: [] }, teamB: { name: 'Yamuna Blockers', color: '#001F4D', players: [] }, summary: { setsA: 0, setsB: 0, setScores: [], currentA: 1, currentB: 0, serving: 'A', winner: null }, location: null } as unknown as Match;
    await render(<LiveMatchCard m={m} />);
    expect(screen.getByText('Delhi Smashers vs Yamuna Blockers · Set 1')).toBeTruthy();
  });
  it('demo seed: Gurgaon Giants has 8 players (2 on the bench); the seeded beach match keeps six a side', () => {
    const { makeSeed } = require('../../services/backend/demoSeed');
    const db = makeSeed(Date.UTC(2026, 9, 11));
    expect(db.teams.team_giants.memberIds).toHaveLength(8);
    expect(db.matches.match_beach.teamB.players).toHaveLength(6);
    expect(db.users.seed26.firstName).toBe('Zoya');
  });
});

describe('F135-5', () => {
  it('/courts redirects to the Map tab (no Unmatched Route)', async () => {
    const Courts = require('../../app/courts').default;
    await render(<Courts />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/map');
  });
});
