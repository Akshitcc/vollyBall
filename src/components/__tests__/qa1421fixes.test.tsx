/**
 * 1.4.22: regression tests for Tester's 1.4.21 findings V1421-1 … V1421-10 (+ the Live theme control).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const R = require('react');
  return { router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams, Stack: { Screen: () => null }, useFocusEffect: (f: () => void) => R.useEffect(f, []) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
const mockTournaments = [{ id: 'tour1', name: 'Monsoon Cup 2026', format: 'knockout', teams: [{}, {}], startDate: '2026-10-18', endDate: '2026-10-20', location: { name: 'Stadium' }, status: 'upcoming', fixtures: [] }];
jest.mock('../../services/backend', () => ({
  backend: {
    sendOtp: jest.fn(),
    watchTournaments: (cb: (t: unknown[]) => void) => (cb(mockTournaments), () => {}),
    listMySupportTickets: jest.fn(async () => []),
  },
}));
jest.mock('../../core/tournament', () => ({ ...jest.requireActual('../../core/tournament'), tournamentDisplayStatus: () => 'upcoming' }));

import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { applyTheme, colors, contrast, font } from '../../theme';
import { tokens } from '../../theme/tokens';
import { ThemeProvider, THEME_KEY, useTheme } from '../../theme/ThemeProvider';
import { ThemeTransition, type TransitionHandle } from '../../theme/ThemeTransition';
import { Banner } from '../ui';
import { buildIndex, retrieve } from '../../core/ask';
import { needsFivbNote } from '../../app/ask';
import { fallbackGraphemes, graphemes, stripHidden, stripHiddenKeepJoiners, visibleLength } from '../../core/text';
import { checkSupportTicket, SUPPORT_MESSAGE_MAX } from '../../core/support';
import { clearSignInReason, noteSignedOutPath, signInReasonKey } from '../../state/signInReason';

const flat = (s: unknown) => StyleSheet.flatten(s as never) as { color?: string; backgroundColor?: string };
afterEach(() => { jest.useRealTimers(); applyTheme('day'); mockParams = {}; });

describe('V1421-4: Night tournament card titles are readable (rendered)', () => {
  for (const th of ['day', 'night'] as const)
    it(`${th}: the rendered title colour has AA contrast on the card`, async () => {
      applyTheme(th);
      const Tournaments = require('../../app/(tabs)/tournaments').default;
      await render(<Tournaments />);
      const c = flat(screen.getByTestId('tournament-name-tour1').props.style).color;
      expect(c).toBeDefined();
      expect(contrast(c!, colors.card)).toBeGreaterThanOrEqual(4.5);
    });
  it('every font.* style carries the live theme text colour (no platform-default black)', () => {
    applyTheme('night');
    for (const k of ['h1', 'h2', 'h3', 'body', 'small'] as const) expect(flat([font[k]]).color).toBe(tokens.night.text === colors.text ? colors.text : colors.text);
    expect(flat([font.h3]).color).toBe(colors.text);
    applyTheme('day');
    expect(flat([font.h3]).color).toBe(colors.text);
  });
});

describe('V1421-5: signed-out Ask → Login says why', () => {
  afterEach(() => clearSignInReason());
  it('remembers sign-in-only screens, not open ones', () => {
    noteSignedOutPath('/login'); expect(signInReasonKey()).toBeNull();
    noteSignedOutPath('/ask'); expect(signInReasonKey()).toBe('errors.codes.ask_sign_in');
    noteSignedOutPath('/wallet'); expect(signInReasonKey()).toBe('login.signInToContinue');
  });
  for (const lng of ['en', 'hi'] as const)
    it(`${lng}: Login shows the friendly Ask message`, async () => {
      await i18n.changeLanguage(lng);
      noteSignedOutPath('/ask');
      const Login = require('../../app/login').default;
      await render(<Login />);
      expect(screen.getByTestId('login-reason')).toBeTruthy();
      expect(screen.getByText(i18n.t('errors.codes.ask_sign_in'))).toBeTruthy();
    });
  it('the root stack records the path while signed out', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/_layout.tsx'), 'utf8') as string;
    expect(src).toMatch(/if \(!loading && !user\) noteSignedOutPath\(pathname\)/);
  });
});

describe('V1421-7: Night demo banner contrast (rendered)', () => {
  for (const th of ['day', 'night'] as const)
    it(th, async () => {
      applyTheme(th);
      await render(<Banner tone="warn" text="Demo mode" testID="b" />);
      const bg = flat(screen.getByTestId('b').props.style).backgroundColor!;
      const fg = flat(screen.getByText('Demo mode').props.style).color!;
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('V1421-8: Help search placeholder', () => {
  it('no "abandon", short enough for 360 px', () => {
    for (const s of [en.help.searchHint, hi.help.searchHint]) { expect(s).not.toMatch(/abandon|छोड़/i); expect([...s].length).toBeLessThanOrEqual(26); }
  });
});

describe('V1421-9: the 1.4 s scene plays (RN Animated, JS driver – the same path on web)', () => {
  it('scene overlay shows, covers at 850 ms (night), ends at 1400 ms; no native driver', async () => {
    jest.useFakeTimers();
    const ref = React.createRef<TransitionHandle>();
    await render(<ThemeTransition ref={ref} />);
    const covered = jest.fn();
    await act(async () => { ref.current!.play('night', 'scene', covered); });
    expect(screen.getByTestId('theme-scene-night', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(849); });
    expect(covered).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(2); });
    expect(covered).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(800); });
    expect(screen.queryByTestId('theme-scene-night', { includeHiddenElements: true })).toBeNull();
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../theme/ThemeTransition.tsx'), 'utf8') as string;
    expect(src).not.toMatch(/useNativeDriver: true/);
    jest.useRealTimers();
  });
});

describe('V1421-10: FIVB note only on answers that cite an FIVB rule summary', () => {
  it('app-only → none; rule linking to FIVB → shown; rule mapped to an FAQ → none', () => {
    expect(needsFivbNote([{ id: 'faq:x', kind: 'faq', title: 'x', url: 'volleylive://help?faq=x' }])).toBe(false);
    expect(needsFivbNote([{ id: 'rules:libero', kind: 'rules', title: 'x', url: 'volleylive://help?faq=team-positions' }])).toBe(false);
    expect(needsFivbNote([{ id: 'faq:x', kind: 'faq', title: 'x', url: 'volleylive://help?faq=x' }, { id: 'rules:net', kind: 'rules', title: 'n', url: 'https://www.fivb.com/x' }])).toBe(true);
  });
});

describe('V1421-1: Ask leads with the topic asked about', () => {
  const ix = buildIndex();
  const top = (q: string, lang: 'en' | 'hi' = 'en') => retrieve(ix, q, lang)[0]?.id.replace(/:(en|hi)$/, '');
  it.each([
    ['how to score a match', 'faq:score-how'], ['How is a match scored?', 'faq:score-how'], ['मैच का स्कोर कैसे करें', 'faq:score-how'],
    ['how many points do I get', 'faq:wallet-points'], ['मुझे कितने पॉइंट मिलते हैं', 'faq:wallet-points'],
    ['what is the net height', 'rules:rule-net-height'], ['how high is the net', 'rules:rule-net-height'], ['नेट की ऊँचाई कितनी है', 'rules:rule-net-height'],
    ['How do I delete my account', 'faq:account-delete'], ['what is a libero', 'rules:rule-libero'], ['how many points win a set', 'rules:rule-set-points'],
  ])('%s → %s', (q, id) => { expect(top(q)).toBe(id); expect(top(q, 'hi')).toBe(id); });
  it('the net height answer states the height', () => {
    expect(retrieve(ix, 'what is the net height', 'en')[0].text).toMatch(/2\.43 m/);
  });
});

describe('V1421-2: ZWJ emoji are one character on phone and server, and are stored whole', () => {
  const fam = '👨‍👩‍👧‍👦';
  it('the fallback (no Intl.Segmenter) counts like the Segmenter', () => {
    const samples = [fam, '👍🏽', '🇮🇳🇬🇧', 'क्षत्रिय', 'नमस्ते', 'e\u0301', '❤️', '🏳️‍🌈', 'a\r\nb', 'abc'];
    for (const s of samples) expect([s, fallbackGraphemes(s).length]).toEqual([s, graphemes(s).length]);
  });
  it('a support message keeps the family emoji, counts it as 1, and Tester’s 1000 of them are accepted', () => {
    const one = checkSupportTicket({ topic: 'bug', message: `Family ${fam} test` });
    expect(one.message).toBe(`Family ${fam} test`);
    expect(visibleLength(fam)).toBe(1);
    const k = fam.repeat(1000); // counter "1000 / 2000" in the app
    expect(visibleLength(k)).toBe(1000);
    expect(checkSupportTicket({ topic: 'bug', message: k }).message).toBe(k); // stored whole, not 4000 split emoji
    expect(() => checkSupportTicket({ topic: 'bug', message: 'x'.repeat(SUPPORT_MESSAGE_MAX + 1) })).toThrow();
  });
  it('a stray ZWJ / other hidden characters are still removed', () => {
    expect(stripHiddenKeepJoiners('ab\u200Dcd\u200B\u202E')).toBe('abcd\u202E'.replace('\u202E', '')); // bidi stripped too
    expect(stripHiddenKeepJoiners(`x\u200D${fam}`)).toBe(`x${fam}`);
    expect(stripHidden(fam)).not.toBe(fam); // the old strip (names, Firebase rules) is unchanged
  });
});

describe('V1421-3: slow cold-start theme read and per-account writes', () => {
  let probe: ReturnType<typeof useTheme>;
  function Probe() { probe = useTheme(); return <Text testID="probe">{probe.name}</Text>; }
  const noon = () => new Date(2026, 9, 13, 12, 0, 0).getTime();
  beforeEach(async () => { jest.useFakeTimers(); await AsyncStorage.clear(); applyTheme('day'); });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  it('a read slower than the timeout still applies the saved choice, and another account is kept on write', async () => {
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ users: { seed1: { setting: 'night', animate: true }, seed2: { setting: 'day', animate: true } } }));
    const savedRaw = await AsyncStorage.getItem(THEME_KEY);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce((() => new Promise((res) => setTimeout(() => res(savedRaw), 500))) as never);
    await render(<ThemeProvider uid="seed1" nowFn={noon}>{() => <Probe />}</ThemeProvider>);
    await act(async () => { jest.advanceTimersByTime(310); });
    expect(probe.name).toBe('day'); // provisional Auto at noon
    for (let i = 0; i < 10; i++) await act(async () => { jest.advanceTimersByTime(60); await Promise.resolve(); await Promise.resolve(); });
    expect(probe.name).toBe('night'); // the late read is applied
    expect(probe.setting).toBe('night');
    await act(async () => { probe.setAnimate(false); jest.advanceTimersByTime(600); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    jest.restoreAllMocks();
    const saved = JSON.parse((await AsyncStorage.getItem(THEME_KEY))!);
    expect(saved.users.seed2).toEqual({ setting: 'day', animate: true });
    expect(saved.users.seed1).toEqual({ setting: 'night', animate: false });
    expect(saved.setting).toBeUndefined(); // a signed-in write never touches the device-wide default
  });
  it('a change made before the slow read lands wins over the late read', async () => {
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ users: { seed1: { setting: 'night', animate: true } } }));
    const savedRaw = await AsyncStorage.getItem(THEME_KEY);
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce((() => new Promise((res) => setTimeout(() => res(savedRaw), 500))) as never);
    await render(<ThemeProvider uid="seed1" nowFn={noon}>{() => <Probe />}</ThemeProvider>);
    await act(async () => { jest.advanceTimersByTime(310); });
    await act(async () => { probe.setSetting('day'); jest.advanceTimersByTime(400); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(600); await Promise.resolve(); await Promise.resolve(); });
    expect(probe.setting).toBe('day');
  });
});

describe('Live scoring theme control (Tester extra)', () => {
  it('the ⋮ menu on Live has a theme switch that uses the soft Live swap', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/match/[id]/score.tsx'), 'utf8') as string;
    expect(src).toMatch(/testID="menu-theme"/);
    expect(src).toMatch(/themeCtl\.setSetting\([^)]*\); themeCtl\.rallyEnded\(\)/);
    expect(en.dn.toNight).toBeTruthy(); expect(hi.dn.toNight).not.toBe(en.dn.toNight);
  });
});

describe('V1421-6: /help?faq=account-delete expands and scrolls (EN + HI)', () => {
  for (const lng of ['en', 'hi'] as const)
    it(`${lng}: the linked FAQ opens expanded`, async () => {
      jest.useFakeTimers();
      await i18n.changeLanguage(lng);
      mockParams = { faq: 'account-delete' };
      const Help = require('../../app/help').default;
      await render(<Help />);
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByTestId('faq-account-delete-answer')).toBeTruthy(); // expanded
      jest.useRealTimers();
    });
  it('scroller: item first, then category → scrolls to category + item offset (twice: instant, then settled)', () => {
    jest.useFakeTimers();
    const { makeFaqScroller } = require('../../app/help');
    const calls: [number, boolean][] = [];
    const sc = makeFaqScroller((y: number, a: boolean) => calls.push([y, a]));
    sc.item('privacy', 130);
    jest.advanceTimersByTime(600);
    expect(calls).toEqual([]); // category offset unknown yet: no jump to ~0
    sc.category('privacy', 1800);
    jest.advanceTimersByTime(600);
    expect(calls).toEqual([[1922, true], [1922, true]]);
  });
  it('help.tsx wires the scroller to both layouts', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/help.tsx'), 'utf8') as string;
    expect(src).toMatch(/onLayout=\{\(e\) => scroller\.category\(c, e\.nativeEvent\.layout\.y\)\}/);
    expect(src).toMatch(/onFocusLayout=\{\(y\) => scrollToFaq\(c, y\)\}/);
    });
});

