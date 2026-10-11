/** Keyboard must not cover inputs (Android APK on a Realme phone): every form screen uses KeyboardAwareScreen. */
import { render, screen } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Platform, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardAwareScreen, KEYBOARD_BEHAVIOR } from '../KeyboardAwareScreen';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));

const load = (os: 'ios' | 'android' | 'web') => {
  let mod: typeof import('../KeyboardAwareScreen') | undefined;
  jest.isolateModules(() => {
    const RN = require('react-native');
    Object.defineProperty(RN.Platform, 'OS', { get: () => os, configurable: true });
    mod = require('../KeyboardAwareScreen');
  });
  return mod!;
};

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
});

it.each([
  ['ios', 'padding'],
  ['android', 'height'],
  ['web', undefined],
] as const)('%s uses KeyboardAvoidingView behavior %s', (os, behavior) => {
  expect(load(os).KEYBOARD_BEHAVIOR).toBe(behavior);
});

it('renders a KeyboardAvoidingView around a ScrollView with keyboardShouldPersistTaps="handled"', async () => {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <KeyboardAwareScreen>
        <TextInput testID="field" />
        <Text>Continue</Text>
      </KeyboardAwareScreen>
    </SafeAreaProvider>,
  );
  const kav = screen.getByTestId('keyboard-aware-screen-kav');
  const sv = screen.getByTestId('keyboard-aware-screen-scroll');
  expect(kav).toBeTruthy(); // its per-platform behavior (KEYBOARD_BEHAVIOR) is checked above
  expect(KEYBOARD_BEHAVIOR).toBe(Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined);
  expect(sv.props.keyboardShouldPersistTaps).toBe('handled');
  expect(screen.getByTestId('field')).toBeTruthy();
});

it('app.config does not also set softwareKeyboardLayoutMode (no double compensation)', () => {
  const cfg = fs.readFileSync(path.resolve(__dirname, '../../../app.config.ts'), 'utf8');
  expect(cfg).not.toMatch(/softwareKeyboardLayoutMode/);
});

const FORMS = [
  'app/login.tsx',
  'app/match/new.tsx',
  'app/team/[id].tsx',
  'app/team/new.tsx',
  'app/setup-profile.tsx',
  'app/edit-profile.tsx',
  'app/tournament/new.tsx',
  'app/challenge/new.tsx',
  'app/court/new.tsx',
];
it.each(FORMS)('%s is wrapped in KeyboardAwareScreen', (f) => {
  const src = fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
  expect(src).toMatch(/<KeyboardAwareScreen[\s>]/);
  expect(src).not.toMatch(/<Screen[\s>]/);
  expect(src).not.toMatch(/<KeyboardAvoidingView/); // only the shared wrapper owns one
});
