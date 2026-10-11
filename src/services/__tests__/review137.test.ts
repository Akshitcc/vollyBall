/**
 * 1.3.7 app rating + feedback + fact of the day: eligibility (3 matches, 60 days, never live, win /
 * POTM only), REVIEW_PREPROMPT on and off, the Rate link fallback chain, feedback validation, daily
 * item pick (IST day, deterministic in any TZ) and validation, demo backend parity.
 */
import { Linking } from 'react-native';
import { REVIEW_RULES, reviewEligible, reviewMomentFor, checkFeedback, FEEDBACK_MAX, PLAY_MARKET_URL, PLAY_WEB_URL } from '../../core/reviewPrompt';
import { BUNDLED_DAILY_ITEMS, checkDailyItem, istDayNumber, pickDaily } from '../../core/dailyItems';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockSR = { isAvailableAsync: jest.fn(async () => true), hasAction: jest.fn(async () => true), requestReview: jest.fn(async () => {}) };
jest.mock('expo-store-review', () => ({
  isAvailableAsync: () => mockSR.isAvailableAsync(),
  hasAction: () => mockSR.hasAction(),
  requestReview: () => mockSR.requestReview(),
}));
const mockDialog = jest.fn(async (_spec: { title: string; buttons: { value: boolean }[] }) => true);
jest.mock('../../state/dialog', () => ({ openDialog: (s: { title: string; buttons: { value: boolean }[] }) => mockDialog(s) }));
jest.mock('../config', () => ({ ...jest.requireActual('../config'), DEMO_ADMIN_UIDS: ['seed2'] }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const review = require('../review') as typeof import('../review');
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 11, 6, 0);

beforeEach(async () => {
  const AS = require('@react-native-async-storage/async-storage');
  await (AS.default ?? AS).clear();
  jest.clearAllMocks();
  mockSR.isAvailableAsync.mockResolvedValue(true);
  mockSR.hasAction.mockResolvedValue(true);
  mockDialog.mockResolvedValue(true);
});

describe('review eligibility (core)', () => {
  const base = { completedMatches: 3, lastAskedAt: null, now: NOW, liveScoring: false, moment: 'won' as const };
  it('needs >= 3 completed matches, a happy moment, not live scoring, 60 days since the last ask', () => {
    expect(REVIEW_RULES).toEqual({ MIN_COMPLETED: 3, COOLDOWN_DAYS: 60, RECENT_MINUTES: 10 });
    expect(reviewEligible(base)).toBe(true);
    expect(reviewEligible({ ...base, completedMatches: 2 })).toBe(false);
    expect(reviewEligible({ ...base, moment: null })).toBe(false);
    expect(reviewEligible({ ...base, moment: 'potm' })).toBe(true);
    expect(reviewEligible({ ...base, liveScoring: true })).toBe(false);
    expect(reviewEligible({ ...base, lastAskedAt: NOW - 59 * DAY })).toBe(false);
    expect(reviewEligible({ ...base, lastAskedAt: NOW - 60 * DAY })).toBe(true);
  });
  it('happy moment: finished + my side won, or I am POTM; never a loss, a live or an abandoned match', () => {
    const m = (over: object) => ({ status: 'finished', summary: { winner: 'A' as const }, playerOfMatchId: null, teamA: { players: [{ id: 'me' }] }, teamB: { players: [{ id: 'x' }] }, ...over });
    expect(reviewMomentFor(m({}), 'me')).toBe('won');
    expect(reviewMomentFor(m({ summary: { winner: 'B' } }), 'me')).toBeNull();
    expect(reviewMomentFor(m({ summary: { winner: 'B' }, playerOfMatchId: 'me' }), 'me')).toBe('potm');
    expect(reviewMomentFor(m({ status: 'live' }), 'me')).toBeNull();
    expect(reviewMomentFor(m({ status: 'abandoned' }), 'me')).toBeNull();
    expect(reviewMomentFor(m({}), 'stranger')).toBeNull();
  });
});

describe('services/review', () => {
  const ask = (over: object = {}) => review.maybeAskForReview({ uid: 'u1', moment: 'won', completedMatches: 3, now: NOW, demo: false, ...over });
  it('default (REVIEW_PREPROMPT off): calls requestReview directly, at most once per 60 days per user', async () => {
    expect(review.REVIEW_PREPROMPT).toBe(false);
    expect(await ask()).toBe(true);
    expect(mockSR.requestReview).toHaveBeenCalledTimes(1);
    expect(mockDialog).not.toHaveBeenCalled(); // no "Enjoying VolleyLive?" gate
    expect(await review.lastAskedAt('u1')).toBe(NOW);
    expect(await ask({ now: NOW + 10 * DAY })).toBe(false);
    expect(await ask({ uid: 'u2', now: NOW + 10 * DAY })).toBe(true); // per user
    expect(await ask({ now: NOW + 61 * DAY })).toBe(true);
    expect(mockSR.requestReview).toHaveBeenCalledTimes(3);
  });
  it('never asks when not eligible (2 matches, live scoring, no happy moment)', async () => {
    expect(await ask({ completedMatches: 2 })).toBe(false);
    expect(await ask({ liveScoring: true })).toBe(false);
    expect(await ask({ moment: null })).toBe(false);
    expect(mockSR.requestReview).not.toHaveBeenCalled();
    expect(await review.lastAskedAt('u1')).toBeNull();
  });
  it('REVIEW_PREPROMPT on: "Not really" never reaches the store; "Yes" does', async () => {
    mockDialog.mockResolvedValueOnce(false);
    expect(await ask({ preprompt: true })).toBe(true);
    expect(mockDialog).toHaveBeenCalledTimes(1);
    expect(mockSR.requestReview).not.toHaveBeenCalled();
    mockDialog.mockResolvedValueOnce(true);
    expect(await ask({ uid: 'u3', preprompt: true })).toBe(true);
    expect(mockSR.requestReview).toHaveBeenCalledTimes(1);
  });
  it('demo: a clearly labelled mock sheet, never the real store', async () => {
    expect(await ask({ demo: true })).toBe(true);
    expect(mockDialog.mock.calls[0][0].title).toBe('Demo: Google Play review would appear here');
    expect(mockSR.requestReview).not.toHaveBeenCalled();
    expect(await review.openStoreListing({ demo: true })).toBe('demo');
  });
  it('Rate VolleyLive: native sheet, else market://, else the https Play page', async () => {
    const can = jest.spyOn(Linking, 'canOpenURL');
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    expect(await review.openStoreListing({ demo: false })).toBe('native');
    mockSR.hasAction.mockResolvedValue(false);
    can.mockResolvedValue(true);
    expect(await review.openStoreListing({ demo: false })).toBe('market');
    expect(open).toHaveBeenLastCalledWith(PLAY_MARKET_URL);
    can.mockResolvedValue(false);
    expect(await review.openStoreListing({ demo: false })).toBe('web');
    expect(open).toHaveBeenLastCalledWith(PLAY_WEB_URL);
    expect(PLAY_MARKET_URL).toBe('market://details?id=com.volleylive.app');
    expect(PLAY_WEB_URL).toBe('https://play.google.com/store/apps/details?id=com.volleylive.app');
  });
});

describe('feedback validation', () => {
  it('1–5 whole stars; text trimmed, control / zero-width removed, <= 1000 characters', () => {
    expect(checkFeedback({ stars: 5, text: '  ok\u200B ' })).toEqual({ stars: 5, text: 'ok' });
    expect(checkFeedback({ stars: 1 })).toEqual({ stars: 1, text: '' });
    for (const s of [0, 6, 2.5, 'x', null]) expect(() => checkFeedback({ stars: s })).toThrow(expect.objectContaining({ code: 'feedback_stars' }));
    expect(checkFeedback({ stars: 3, text: 'अ'.repeat(FEEDBACK_MAX) }).text).toHaveLength(FEEDBACK_MAX);
    expect(() => checkFeedback({ stars: 3, text: 'x'.repeat(FEEDBACK_MAX + 1) })).toThrow(expect.objectContaining({ code: 'feedback_too_long' }));
  });
});

describe('fact of the day', () => {
  it('>= 60 bundled facts, EN + HI (Devanagari), no unverified quotes', () => {
    expect(BUNDLED_DAILY_ITEMS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(BUNDLED_DAILY_ITEMS.map((x) => x.id)).size).toBe(BUNDLED_DAILY_ITEMS.length);
    for (const x of BUNDLED_DAILY_ITEMS) {
      expect(x.textEn.length).toBeGreaterThan(10);
      expect(x.textHi).toMatch(/[\u0900-\u097F]/);
      expect(() => checkDailyItem(x)).not.toThrow();
      if (x.type === 'quote') expect(x.sourceUrl).toMatch(/^https:\/\//);
    }
  });
  it('one item per IST calendar day (changes at IST midnight, not UTC); tap = next; same in every TZ', () => {
    const before = Date.UTC(2026, 9, 10, 18, 29); // 23:59 IST
    const after = Date.UTC(2026, 9, 10, 18, 30); // 00:00 IST next day
    expect(istDayNumber(after) - istDayNumber(before)).toBe(1);
    expect(pickDaily(BUNDLED_DAILY_ITEMS, before)!.id).not.toBe(pickDaily(BUNDLED_DAILY_ITEMS, after)!.id);
    expect(pickDaily(BUNDLED_DAILY_ITEMS, before, 1)!.id).toBe(pickDaily(BUNDLED_DAILY_ITEMS, after)!.id);
    expect(pickDaily(BUNDLED_DAILY_ITEMS, NOW)!.id).toBe(pickDaily(BUNDLED_DAILY_ITEMS, NOW + 3600_000)!.id);
    // the pick is a pure function of the IST date: pin one so a TZ change would show (npm run test:tz)
    expect(pickDaily(BUNDLED_DAILY_ITEMS, Date.UTC(2026, 0, 1, 0, 0))!.id).toBe(pickDaily(BUNDLED_DAILY_ITEMS, Date.UTC(2026, 0, 1, 18, 29))!.id);
    const off = BUNDLED_DAILY_ITEMS.map((x) => ({ ...x, active: x.id === 'b07' }));
    expect(pickDaily(off, NOW)!.id).toBe('b07');
    expect(pickDaily([], NOW)).toBeNull();
  });
  it('validation: type, both texts, quotes need attribution + https source', () => {
    const q = { type: 'quote' as const, textEn: 'Q', textHi: 'क', attribution: 'A', sourceUrl: 'https://x.org/a', active: true };
    expect(checkDailyItem(q).type).toBe('quote');
    for (const bad of [{ ...q, sourceUrl: '' }, { ...q, attribution: '' }, { ...q, sourceUrl: 'http://x.org' }, { ...q, type: 'joke' }, { ...q, textHi: '' }, { ...q, textEn: 'x'.repeat(401) }])
      expect(() => checkDailyItem(bad as never)).toThrow(expect.objectContaining({ code: 'daily_invalid' }));
  });
});

describe('demo backend: feedback + daily items (parity with the API and rules)', () => {
  const { DemoBackend } = require('../backend/demoBackend');
  const { TERMS_VERSION } = require('../../core/terms');
  async function signedIn(n: number, terms = true) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    const otp = b.sendOtp(`+9190000000${String(n + 9).padStart(2, '0')}`);
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    if (terms) await b.acceptTerms(b.authUser.uid, TERMS_VERSION);
    return b;
  }
  const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));
  it('feedback: anyone signed in sends; only the (demo) admin reads; rate limited', async () => {
    const b = await signedIn(1);
    await b.sendFeedback({ stars: 4, text: 'Nice' });
    expect(await codeOf(b.sendFeedback({ stars: 9, text: '' }))).toBe('feedback_stars');
    expect(await codeOf(b.listFeedback())).toBe('admin_only');
    for (let i = 0; i < 4; i++) await b.sendFeedback({ stars: 5, text: '' });
    expect(await codeOf(b.sendFeedback({ stars: 5, text: '' }))).toBe('rate_limited');
  });
  it('1.3.8 (V137-5): feedback needs accepted T&C, like the API', async () => {
    const b = await signedIn(1, false);
    expect(await codeOf(b.sendFeedback({ stars: 4, text: 'Nice' }))).toBe('terms_not_accepted');
  });
  it('1.3.8 (V137-2): a new user without name / date of birth / pincode cannot create a match', async () => {
    const b = await signedIn(90); // +919000000099, a new number
    expect(b.authUser.uid).not.toMatch(/^seed/);
    const m = { teamA: { teamId: null, name: 'A', color: '#000000', players: [] }, teamB: { teamId: null, name: 'B', color: '#ffffff', players: [] }, status: 'scheduled', events: [], createdBy: b.authUser.uid, scorerId: b.authUser.uid, participantIds: [b.authUser.uid] };
    expect(await codeOf(b.createMatch(m as never))).toBe('profile_incomplete');
  });
  it('daily items: the bundled list to start; only the demo admin adds / edits / deletes', async () => {
    const b = await signedIn(1);
    expect((await b.listDailyItems()).length).toBe(BUNDLED_DAILY_ITEMS.length);
    expect(await codeOf(b.saveDailyItem({ type: 'fact', textEn: 'x', textHi: 'य', active: true }))).toBe('admin_only');
    const a = await signedIn(2); // seed2 = demo admin (EXPO_PUBLIC_DEMO_ADMIN_UIDS)
    const id = await a.saveDailyItem({ type: 'fact', textEn: 'New fact', textHi: 'नया तथ्य', active: true });
    await a.saveDailyItem({ id, type: 'fact', textEn: 'New fact', textHi: 'नया तथ्य', active: false });
    expect((await a.listDailyItems()).some((x: { id: string }) => x.id === id)).toBe(false); // hidden from Home
    expect((await a.listDailyItems({ all: true })).find((x: { id: string }) => x.id === id).active).toBe(false);
    await a.deleteDailyItem(id);
    expect((await a.listDailyItems({ all: true })).some((x: { id: string }) => x.id === id)).toBe(false);
    expect(await codeOf(a.saveDailyItem({ type: 'quote', textEn: 'q', textHi: 'क', active: true }))).toBe('daily_invalid');
  });
});
