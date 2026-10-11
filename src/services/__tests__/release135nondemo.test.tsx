/**
 * 1.3.5 (QA E134-2 scope addition): "Demo admin" never exists outside demo mode. This file runs the
 * REAL config resolution with API-mode settings (as a non-demo / production build would have) and
 * checks every way in: the shipped backend isn't the demo one, a demo backend created anyway refuses
 * the switch and ignores a stored flag, and the Testing tools card renders nothing. Also E134-6:
 * About shows the API host in API mode. No secrets: a private-LAN URL and dev auth only.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('../config', () => {
  process.env.EXPO_PUBLIC_BACKEND = 'api';
  process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.10:4000';
  process.env.EXPO_PUBLIC_API_DEV_AUTH = '1';
  delete process.env.EXPO_PUBLIC_DEMO_MODE;
  delete process.env.EXPO_PUBLIC_DEMO_ADMIN_UIDS;
  return jest.requireActual('../config');
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'seed_admin', phoneNumber: '+919000000001' }, isAdmin: false, refreshAdmin: async () => {} }),
}));

// No network in this test: the API backend's requests fail at once (nothing is contacted).
const mockFetch = jest.fn(async () => {
  throw new TypeError('Network request failed');
});
(globalThis as { fetch: unknown }).fetch = mockFetch;

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AboutCard, DemoQaTools } from '../../components/AboutCard';
import i18n from '../../i18n';
import { backend } from '../backend';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import { API_HOST, BACKEND_KIND, DEMO_MODE } from '../config';

describe('non-demo (API / production) build: no Demo admin', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('the build resolves to API mode, and the shipped backend is not the demo backend', () => {
    expect(DEMO_MODE).toBe(false);
    expect(BACKEND_KIND).toBe('api');
    expect(backend).not.toBeInstanceOf(DemoBackend);
    expect('setDemoAdmin' in (backend as object)).toBe(false);
    expect('canBeDemoAdmin' in (backend as object)).toBe(false);
  });

  it('a demo backend created anyway: the seed admin cannot switch it on, and a stored flag is ignored', async () => {
    await AsyncStorage.setItem('volleylive-demo-qa-admin-v1', JSON.stringify([DEMO_QA_ADMIN.id]));
    const b = new DemoBackend();
    await (b as unknown as { ready: Promise<void> }).ready;
    expect(b.canBeDemoAdmin(DEMO_QA_ADMIN.id)).toBe(false);
    expect(b.isDemoAdmin(DEMO_QA_ADMIN.id)).toBe(false);
    expect(await b.isAdmin(DEMO_QA_ADMIN.id)).toBe(false);
    await expect(b.setDemoAdmin(true)).rejects.toThrow('only available in demo mode');
    clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer); // its live-match ticker
  });

  it('Profile › Testing tools (Demo admin, Simulate offline) renders nothing', async () => {
    const r = await render(<DemoQaTools />);
    expect(r.toJSON()).toBeNull();
    expect(screen.queryByTestId('demo-admin-switch')).toBeNull();
    expect(screen.queryByTestId('demo-qa-tools')).toBeNull();
  });

  it('E134-6: About shows the API host (from the build config) in API mode', async () => {
    expect(API_HOST).toBe('192.168.1.10:4000');
    await render(<AboutCard />);
    expect(screen.getByTestId('about-api-host')).toHaveTextContent(/192\.168\.1\.10:4000/);
    expect(screen.getByTestId('about-backend')).toBeTruthy();
  });
});
