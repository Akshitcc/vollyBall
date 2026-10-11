/**
 * Input-validation build + Tester's 216 retest/visual pass: N2 (OTP paste), N4 (legacy numbers:
 * profile save + invites state), V4 (challenge team), G16 (maxLength everywhere + translated codes),
 * B5 (duplicate-player reason wraps), disabled buttons, G10 photo error message.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, act } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import i18n from '../../i18n';
import { photoErrorMessage, translateCode, translateError } from '../../i18n/format';
import { Banner, Button } from '../ui';
import { colors } from '../../theme';
import { ValidationError } from '../../core/validate';
import { DemoBackend } from '../../services/backend/demoBackend';
import { inviteState } from '../../services/backend/types';
import { ApiBackend } from '../../services/backend/apiBackend';
import { pickFromTeam } from '../../core/challengeTeam';
import Login, { cleanOtp, OTP_PASTE_ROOM } from '../../app/login';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}) }));
const mockSendOtp = jest.fn(async () => ({ confirm: jest.fn(async () => undefined) }));
jest.mock('../../services/backend', () => ({ backend: { sendOtp: () => mockSendOtp() } }));

const flat = (st: unknown): Record<string, unknown> => Object.assign({}, ...(([] as unknown[]).concat(st as never).flat(5).filter(Boolean) as object[]));

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('N2: OTP paste with separators', () => {
  test('filter keeps 6 digits; native limit leaves room for the paste', () => {
    expect(OTP_PASTE_ROOM).toBeGreaterThanOrEqual(12);
    expect(cleanOtp('123 456')).toBe('123456');
    expect(cleanOtp('12-34-56')).toBe('123456');
    expect(cleanOtp('१२३ ४५६')).toBe('123456');
    expect(cleanOtp('1234567')).toBe('123456');
  });
  test.each(['123 456', '12-34-56'])('login screen: %p fills the code and enables Verify', async (paste) => {
    await render(<Login />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '9876543210');
    await act(async () => {
      fireEvent.press(screen.getByTestId('send-otp'));
    });
    const otp = await screen.findByTestId('otp-input');
    expect(otp.props.maxLength).toBe(OTP_PASTE_ROOM);
    expect(flat(screen.getByTestId('verify-otp').props.style).backgroundColor).toBe(colors.disabledBg);
    expect(screen.getByTestId('verify-otp-hint')).toBeTruthy(); // says what's missing
    await fireEvent.changeText(otp, paste);
    expect(screen.getByTestId('otp-input').props.value).toBe('123456');
    expect(screen.getByTestId('verify-otp').props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    expect(screen.queryByTestId('verify-otp-hint')).toBeNull();
  });
});

describe('N4: accounts with a number from before build 216', () => {
  async function signedIn() {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    const otp = b.sendOtp('+919000000010');
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    // 1.3.0: every write needs the current T&C accepted (the gate itself is tested in terms130)
    await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
    return b;
  }
  test('demo: saving with the phone unchanged works; changing it to a bad number is refused; nothing is rewritten', async () => {
    const b = await signedIn();
    const db = (b as unknown as { db: { users: Record<string, { phone: string; name: string; city?: string }> } }).db;
    db.users.seed1.phone = '+14155552671'; // legacy
    const me = { ...db.users.seed1 } as never as Parameters<DemoBackend['saveProfile']>[0];
    await expect(b.saveProfile({ ...me, name: 'Aarav S', city: '   ' })).resolves.toBeUndefined();
    expect(db.users.seed1.phone).toBe('+14155552671'); // not migrated
    expect(db.users.seed1.city).toBe(''); // B3
    await expect(b.saveProfile({ ...me, phone: '+447700900123' })).rejects.toThrow();
    await expect(b.saveProfile({ ...me, phone: '+919876543210' })).resolves.toBeUndefined();
  });
  test('demo + API: invites report invalid_phone instead of a silently empty list', async () => {
    expect(inviteState('+14155552671')).toBe('invalid_phone');
    expect(inviteState('+919876543210')).toBe('ok');
    const b = await signedIn();
    const states: string[] = [];
    const lists: unknown[][] = [];
    b.watchTeamInvites('+14155552671', (l) => lists.push(l), (s) => states.push(s));
    expect(states).toEqual(['invalid_phone']);
    expect(lists[0]).toEqual([]);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    const api = new ApiBackend({ baseUrl: 'http://api.local:4000', devAuth: true });
    const apiStates: string[] = [];
    api.watchTeamInvites('+14155552671', () => {}, (s) => apiStates.push(s));
    expect(apiStates).toEqual(['invalid_phone']);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('invitedPhone'), expect.anything());
  });
  test('the home banner text and link exist in EN and HI', async () => {
    const onPress = jest.fn();
    await render(<Banner tone="warn" text={i18n.t('home.updatePhoneInvites')} testID="b" action={{ label: i18n.t('home.updatePhoneLink'), onPress, testID: 'link' }} />);
    expect(screen.getByText(/^Update your mobile number to see team invites/)).toBeTruthy();
    expect(screen.getByText('Update mobile number')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('link'));
    expect(onPress).toHaveBeenCalled();
    await i18n.changeLanguage('hi');
    expect(i18n.t('home.updatePhoneInvites')).toMatch(/मोबाइल नंबर अपडेट करें/);
    expect(i18n.t('profileForm.phoneOutdated', { phone: '+14155552671' })).toContain('+14155552671');
    expect(translateCode({ code: 'invalid_phone' })).toBe(i18n.t('errors.invalidPhone'));
  });
});

describe('G16: translated codes, never raw English', () => {
  test.each(['en', 'hi'])('%s', async (lng) => {
    await i18n.changeLanguage(lng);
    const long = translateError(new ValidationError('text_too_long', 'name', { max: 40 }));
    expect(long).toContain('40');
    expect(long).not.toMatch(/text_too_long|\(name\)/);
    for (const code of ['text_empty', 'text_too_short', 'text_control', 'text_bidi', 'time_in_past', 'end_before_start', 'rules_invalid', 'duplicate_teams', 'need_two_teams', 'team_name_mismatch', 'photo_type', 'photo_empty', 'photo_too_large', 'photo_url', 'photo_upload_failed']) {
      const msg = translateCode({ code, field: 'name', min: 2, max: 40 });
      expect(msg).toBeTruthy();
      expect(msg).not.toContain('errors.');
    }
    // API error body {error: code, field, max} is translated the same way
    expect(translateError(Object.assign(new Error('x'), { code: 'text_too_long', field: 'city', max: 80 }))).toContain('80');
    // G10: a failed match photo upload always says something
    expect(photoErrorMessage(new Error('network down'))).toBe(i18n.t('errors.codes.photo_upload_failed'));
    expect(photoErrorMessage(Object.assign(new Error('x'), { code: 'photo_too_large' }))).toBe(i18n.t('errors.codes.photo_too_large'));
  });

  test('every text input in the app has a maxLength', () => {
    const root = path.resolve(__dirname, '../..');
    const files = ['components', 'app'].flatMap(function walk(d: string): string[] {
      return fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : [],
      );
    });
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of src.matchAll(/<(Field|TextInput)\b([\s\S]*?)\/>/g)) {
        if (f.endsWith('ui.tsx') && m[2].includes('{...props}')) continue; // the Field wrapper itself
        if (!/maxLength=/.test(m[2])) missing.push(`${f}: <${m[1]}${m[2].slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('V4: /challenge/new without a team', () => {
  test('uses my only captained team, the requested one when I captain it, else asks', () => {
    expect(pickFromTeam(['t1'], undefined, null)).toBe('t1');
    expect(pickFromTeam(['t1', 't2'], 't2', null)).toBe('t2');
    expect(pickFromTeam(['t1', 't2'], undefined, null)).toBeNull(); // the screen shows the chooser
    expect(pickFromTeam(['t1', 't2'], undefined, 't1')).toBe('t1');
    expect(pickFromTeam(['t1'], 'someone-elses', null)).toBe('t1');
    expect(pickFromTeam([], undefined, null)).toBeNull(); // only then: "captains only"
  });
});

describe('disabled buttons', () => {
  test('solid grey with dark grey text and an optional hint', async () => {
    await render(<Button title="Go" disabled disabledHint="Enter a number first" testID="go" />);
    const st = flat(screen.getByTestId('go').props.style);
    expect(st.backgroundColor).toBe(colors.disabledBg);
    expect(st.opacity).toBe(1);
    expect(screen.getByText('Enter a number first')).toBeTruthy();
    expect(flat(screen.getByText('Go').props.style).color).toBe(colors.disabledText);
  });
});
