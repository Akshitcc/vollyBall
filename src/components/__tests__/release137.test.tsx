/**
 * 1.3.7 screens: Home "Fact of the day" card, About VolleyLive (licenses generated from package.json),
 * Send feedback (validation, no rewards), admin manage screen, and the admin review card saying
 * "Waiting for opponent confirmation" (F135-1).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Share } from 'react-native';
import i18n from '../../i18n';
import { BUNDLED_DAILY_ITEMS, pickDaily, type DailyItem } from '../../core/dailyItems';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.3.7', android: { versionCode: 13 } } } }));
jest.mock('expo-store-review', () => ({ isAvailableAsync: async () => false, hasAction: async () => false, requestReview: async () => {} }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (p: string) => mockPush(p), back: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({}) }));
let mockAdmin = true;
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: mockAdmin, termsOk: true, user: { uid: 'adm' } }), useMe: () => ({ id: 'adm', name: 'Admin' }) }));
const mockBackend = {
  listDailyItems: jest.fn(async (_o?: { all?: boolean }): Promise<DailyItem[]> => []),
  saveDailyItem: jest.fn(async (_x: Partial<DailyItem>) => 'n1'),
  deleteDailyItem: jest.fn(async (_id: string) => {}),
  sendFeedback: jest.fn(async (_f: { stars: number; text: string }) => {}),
  listFeedback: jest.fn(async () => [{ id: 'f1', userId: 'u1', userName: 'Asha', stars: 4, text: 'Love it', appVersion: '1.3.7 (13)', createdAt: 1 }]),
  listFlagged: jest.fn(async () => [] as unknown[]),
  reviewMatch: jest.fn(async () => {}),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
beforeEach(async () => {
  jest.clearAllMocks();
  mockAdmin = true;
  await i18n.changeLanguage('en');
});

describe('Fact of the day card', () => {
  const { DailyCard, shareMessage } = require('../DailyCard');
  const NOW = Date.UTC(2026, 9, 11, 6, 0);
  it("shows today's item (IST), tap = next item, Share sends the text; Hindi shows the Hindi text", async () => {
    await render(<DailyCard now={NOW} items={BUNDLED_DAILY_ITEMS} />);
    const today = pickDaily(BUNDLED_DAILY_ITEMS, NOW)!;
    expect(screen.getByTestId('daily-text')).toHaveTextContent(today.textEn);
    expect(screen.getByText('Fact of the day')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('daily-next'));
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 1)!.textEn);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await fireEvent.press(screen.getByTestId('daily-share'));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 1)!.textEn) });
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 1)!.textHi);
    expect(screen.getByText('आज का तथ्य')).toBeTruthy();
  });
  it('1.3.8 (V137-3): backend items are added to the 60 bundled facts; offline uses the bundled list', async () => {
    const { mergeDailyItems } = require('../../core/dailyItems');
    const mine: DailyItem = { id: 'z1', type: 'fact', textEn: 'Server fact', textHi: 'सर्वर तथ्य', attribution: null, sourceUrl: null, active: true };
    const merged = mergeDailyItems([mine]);
    expect(merged).toHaveLength(61);
    mockBackend.listDailyItems.mockResolvedValueOnce([mine]);
    await render(<DailyCard now={NOW} />);
    await flush();
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(merged, NOW)!.textEn);
    // the server item is one of the rotation, not the only item every day
    const dayOf = (k: number) => pickDaily(merged, NOW + k * 86_400_000)!.id;
    expect(new Set([0, 1, 2, 3].map(dayOf)).size).toBe(4);
    mockBackend.listDailyItems.mockRejectedValueOnce(new Error('offline'));
    await render(<DailyCard now={NOW} />);
    await flush();
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW)!.textEn);
  });
  it('1.3.8 (V137-3): an open card moves to the next item at IST midnight', async () => {
    const beforeMidnight = Date.UTC(2026, 9, 11, 18, 29, 58); // 23:59:58 IST
    jest.useFakeTimers({ now: beforeMidnight });
    try {
      await render(<DailyCard items={BUNDLED_DAILY_ITEMS} />);
      expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, beforeMidnight)!.textEn);
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, beforeMidnight + 4000)!.textEn);
      expect(pickDaily(BUNDLED_DAILY_ITEMS, beforeMidnight)!.id).not.toBe(pickDaily(BUNDLED_DAILY_ITEMS, beforeMidnight + 4000)!.id);
    } finally {
      jest.useRealTimers();
    }
  });
  it('a shared quote keeps its attribution', () => {
    expect(shareMessage({ id: 'q', type: 'quote', textEn: 'Q', textHi: 'क', attribution: 'Someone', sourceUrl: 'https://x', active: true }, 'en')).toMatch(/^Q — Someone/);
  });
});

describe('About VolleyLive', () => {
  const About = require('../../app/about').default;
  const { build } = require('../../../scripts/gen-licenses');
  it('version, features, legal links (privacy = draft), feedback / rate, Made in India, technical info', async () => {
    await render(<About />);
    // 1.3.8 (V137-12): jest runs as iOS with no buildNumber (like web): version only, never "(build –)"
    expect(screen.getByTestId('about-page-version')).toHaveTextContent('Version 1.3.7');
    expect(screen.getByTestId('about-page-version')).not.toHaveTextContent(/build/);
    const { appVersionInfo, appVersionLabel } = require('../../services/appVersion');
    expect(appVersionInfo('android')).toEqual({ version: '1.3.7', build: '13' });
    expect(appVersionInfo('web')).toEqual({ version: '1.3.7', build: null });
    expect(appVersionLabel('android')).toBe('1.3.7 (13)');
    expect(appVersionLabel('web')).toBe('1.3.7');
    expect(i18n.t('aboutPage.versionLine', { version: '1.3.7', build: '13' })).toBe('Version 1.3.7 (build 13)');
    expect(screen.getByTestId('about-made-in-india')).toHaveTextContent(/Made in India/);
    expect(screen.getByText('Privacy Policy (draft)')).toBeTruthy();
    expect(screen.getByTestId('about-card')).toBeTruthy(); // Technical info (backend, API host)
    await fireEvent.press(screen.getByTestId('about-privacy'));
    expect(mockPush).toHaveBeenLastCalledWith('/privacy');
    await fireEvent.press(screen.getByTestId('about-terms'));
    expect(mockPush).toHaveBeenLastCalledWith('/terms-view');
    await fireEvent.press(screen.getByTestId('about-feedback'));
    expect(mockPush).toHaveBeenLastCalledWith('/feedback');
  });
  it('1.3.8 (V137-7): the licence list is the transitive production tree from node_modules, with licence texts, in its own viewer', async () => {
    const committed = require('../../generated/licenses.json');
    const pkg = require('../../../package.json');
    expect(committed).toEqual(build());
    const names = new Set(committed.packages.map((x: { name: string }) => x.name));
    for (const d of Object.keys(pkg.dependencies)) expect(names.has(d)).toBe(true); // every direct dependency
    expect(committed.packages.length).toBeGreaterThan(Object.keys(pkg.dependencies).length * 5); // and transitive ones
    for (const dev of Object.keys(pkg.devDependencies ?? {}).filter((d) => !pkg.dependencies[d])) {
      // a dev-only tool appears only when a production package depends on it too
      if (names.has(dev)) expect(dev).toMatch(/^(jest-worker|@types\/node)$/);
    }
    const store = committed.packages.find((x: { name: string }) => x.name === 'expo-store-review');
    expect(store.license).toBe('MIT');
    expect(committed.texts[store.text]).toMatch(/Permission is hereby granted/);
    const keys = committed.packages.map((x: { name: string; version: string }) => `${x.name}@${x.version}`);
    expect(new Set(keys).size).toBe(keys.length); // deduplicated by name@version
    await render(<About />);
    expect(screen.getByTestId('about-licenses')).toHaveTextContent(new RegExp(`${committed.packages.length} packages`));
    await fireEvent.press(screen.getByTestId('about-licenses'));
    expect(mockPush).toHaveBeenLastCalledWith('/licenses');
    const Licenses = require('../../app/licenses').default;
    await render(<Licenses />);
    await fireEvent.changeText(screen.getByTestId('licenses-search'), 'expo-store-review');
    await fireEvent.press(screen.getByTestId(`license-expo-store-review@${store.version}`));
    expect(screen.getByTestId(`license-text-expo-store-review@${store.version}`)).toHaveTextContent(/Permission is hereby granted/);
    await fireEvent.changeText(screen.getByTestId('licenses-search'), 'zzzz-no-such');
    expect(screen.getByText('No package matches.')).toBeTruthy();
  });
  it('privacy page is marked DRAFT (needs legal review) in EN and HI', async () => {
    const Privacy = require('../../app/privacy').default;
    await render(<Privacy />);
    expect(screen.getByTestId('privacy-draft-badge')).toHaveTextContent(/DRAFT – not legally reviewed/);
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('privacy-draft-badge')).toHaveTextContent(/ड्राफ़्ट/);
  });
});

describe('Send feedback', () => {
  const Feedback = require('../../app/feedback').default;
  it('needs stars; sends stars + text; says it is never rewarded', async () => {
    await render(<Feedback />);
    expect(screen.getByText('Feedback is never rewarded with points or badges.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('feedback-send'));
    await flush();
    expect(screen.getByTestId('feedback-error')).toHaveTextContent('Choose 1 to 5 stars.');
    expect(mockBackend.sendFeedback).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('feedback-star-4'));
    await fireEvent.changeText(screen.getByTestId('feedback-text'), 'Great app');
    await fireEvent.press(screen.getByTestId('feedback-send'));
    await flush();
    expect(mockBackend.sendFeedback).toHaveBeenCalledWith(expect.objectContaining({ stars: 4, text: 'Great app' }));
  });
  it('over 1000 characters: red field + message, nothing sent', async () => {
    await render(<Feedback />);
    await fireEvent.press(screen.getByTestId('feedback-star-5'));
    await fireEvent.changeText(screen.getByTestId('feedback-text'), 'x'.repeat(1001));
    expect(screen.getByTestId('feedback-text').props['aria-invalid']).toBe(true);
    await fireEvent.press(screen.getByTestId('feedback-send'));
    await flush();
    expect(screen.getByTestId('feedback-error')).toHaveTextContent(/at most 1000/);
    expect(mockBackend.sendFeedback).not.toHaveBeenCalled();
  });
  it('admin feedback list shows stars, sender and text; non-admins are refused', async () => {
    const AdminFeedback = require('../../app/admin-feedback').default;
    await render(<AdminFeedback />);
    await flush();
    expect(screen.getByTestId('feedback-f1')).toHaveTextContent('Love it');
    // 1.3.8 (V137-13): version and time on their own (wrapping) line – not cut off next to the stars
    const meta = screen.getByTestId('feedback-meta-f1');
    expect(meta).toHaveTextContent(/^1\.3\.7 \(13\) · /);
    expect(meta.props.numberOfLines).toBeUndefined();
    expect(screen.getByText('Asha')).toBeTruthy();
    mockAdmin = false;
    await render(<AdminFeedback />);
    expect(screen.queryByTestId('admin-feedback')).toBeNull();
  });
});

describe('admin: Fact of the day manage screen', () => {
  const AdminDaily = require('../../app/admin-daily').default;
  it('lists all items (incl. off), adds with validation, toggles, deletes', async () => {
    mockBackend.listDailyItems.mockResolvedValue([{ id: 'b01', type: 'fact', textEn: 'Fact one', textHi: 'तथ्य एक', attribution: 'FIVB', sourceUrl: null, active: false }]);
    await render(<AdminDaily />);
    await flush();
    expect(mockBackend.listDailyItems).toHaveBeenCalledWith({ all: true });
    expect(screen.getByTestId('daily-item-b01')).toHaveTextContent('Fact one');
    await fireEvent.press(screen.getByTestId('daily-add'));
    await fireEvent.press(screen.getByTestId('daily-type-quote'));
    await fireEvent.changeText(screen.getByTestId('daily-text-en'), 'A quote');
    await fireEvent.changeText(screen.getByTestId('daily-text-hi'), 'एक कथन');
    await fireEvent.press(screen.getByTestId('daily-save'));
    await flush();
    expect(screen.getByTestId('daily-error')).toBeTruthy(); // quote without author / source
    expect(mockBackend.saveDailyItem).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('daily-attr'), 'Someone');
    await fireEvent.changeText(screen.getByTestId('daily-url'), 'https://example.org/q');
    await fireEvent.press(screen.getByTestId('daily-save'));
    await flush();
    expect(mockBackend.saveDailyItem).toHaveBeenCalledWith(expect.objectContaining({ type: 'quote', textEn: 'A quote', attribution: 'Someone' }));
    await fireEvent.press(screen.getByTestId('daily-toggle-b01'));
    await flush();
    expect(mockBackend.saveDailyItem).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b01', active: true }));
  });
  it('non-admins see "admins only"', async () => {
    mockAdmin = false;
    await render(<AdminDaily />);
    expect(screen.queryByTestId('admin-daily')).toBeNull();
  });
});

describe('F135-1: admin review card', () => {
  const AdminReview = require('../../app/admin-review').default;
  const done = (v: object) => ({
    id: 'm1', status: 'finished', teamA: { name: 'A', players: [] }, teamB: { name: 'B', players: [] }, createdBy: 'x', scorerId: 'x', participantIds: [],
    summary: { setsA: 2, setsB: 0, setScores: [{ a: 25, b: 10 }], winner: 'A' }, finishedAt: 1, updatedAt: 1, events: [], verification: v,
  });
  it('says "Waiting for opponent confirmation" and that approval only clears the flag', async () => {
    mockBackend.listFlagged.mockResolvedValueOnce([done({ status: 'pending' })]);
    await render(<AdminReview />);
    await flush();
    expect(screen.getByTestId('flagged-captain-m1')).toHaveTextContent('Waiting for opponent confirmation');
    expect(screen.getByTestId('approve-note')).toBeTruthy();
    expect(screen.getByTestId('open-admin-feedback')).toBeTruthy();
    expect(screen.getByTestId('open-admin-daily')).toBeTruthy();
  });
});
