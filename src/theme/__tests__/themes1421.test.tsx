/** 1.4.21 Day/Night themes – spec test cases (minus the OS-dark rule, left out on purpose), greeting cut-offs,
 * timezone, AA contrast in both themes, provider behaviour (storage, animation modes, live hold), 360 px layout. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { AppState, Text } from 'react-native';
import i18n from '../../i18n';
import { _setReduceMotion } from '../../hooks/useReduceMotion';
import { applyTheme, colors, contrast, currentTheme, THEMES, AA_TEXT_PAIRS, AA_UI_PAIRS } from '../index';
import { firstName, greeting, msToNextBoundary, resolveTheme, timeTheme } from '../resolve';
import { parseStored, settingFor, THEME_KEY, ThemeProvider, useLiveThemeHold, useTheme } from '../ThemeProvider';
import { coveredAt, SCENE_MS } from '../ThemeTransition';
import { SPEC_TEXT_PAIRS, tokens } from '../tokens';
import { hiFont } from '../useHiFont';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const H = { includeHiddenElements: true }; // the overlay is hidden from screen readers by design
const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 13, h, m, s);

describe('spec §1 resolveTheme / timeTheme (local time)', () => {
  it.each([[5, 59, 'night'], [6, 0, 'day'], [17, 59, 'day'], [18, 0, 'night'], [0, 0, 'night'], [12, 0, 'day'], [23, 59, 'night']] as const)('%i:%i → %s', (h, m, want) => {
    expect(timeTheme(at(h, m))).toBe(want);
    expect(resolveTheme('auto', at(h, m))).toBe(want);
  });
  it('exactly 18:00:00 and 06:00:00 switch at that second; 17:59:59 is still day', () => {
    expect(timeTheme(at(18, 0, 0))).toBe('night');
    expect(timeTheme(at(6, 0, 0))).toBe('day');
    expect(timeTheme(at(17, 59, 59))).toBe('day');
  });
  it('fixed settings ignore the clock', () => {
    expect(resolveTheme('day', at(23))).toBe('day');
    expect(resolveTheme('night', at(12))).toBe('night');
  });
  it('Auto is time-only (OS dark rule left out, Akshit 1.4.21): resolveTheme has no OS input', () => {
    expect(resolveTheme.length).toBeLessThanOrEqual(2);
    expect(resolveTheme('auto', at(12))).toBe('day');
  });
  it('msToNextBoundary', () => {
    expect(msToNextBoundary(at(5, 59, 30))).toBe(30_000);
    expect(msToNextBoundary(at(17, 0))).toBe(3_600_000);
    expect(msToNextBoundary(at(18, 0))).toBe(12 * 3_600_000);
    expect(msToNextBoundary(at(23, 0))).toBe(7 * 3_600_000);
    expect(msToNextBoundary(at(17, 59, 59.9))).toBeGreaterThanOrEqual(1000); // never a 0 ms busy loop
  });
});

describe('spec §5 greeting cut-offs', () => {
  it.each([[4, 59, 'night'], [5, 0, 'morning'], [11, 59, 'morning'], [12, 0, 'afternoon'], [16, 59, 'afternoon'], [17, 0, 'evening'], [20, 59, 'evening'], [21, 0, 'night']] as const)('%i:%i → %s', (h, m, want) => {
    expect(greeting(at(h, m))).toBe(want);
  });
  it('greeting and theme are independent clocks (17:30 = evening but still Day)', () => {
    expect(greeting(at(17, 30))).toBe('evening');
    expect(timeTheme(at(17, 30))).toBe('day');
  });
  it('first name', () => {
    expect(firstName('  Aarav   Sharma ')).toBe('Aarav');
    expect(firstName('\u200bअक्षित कुमार')).toBe('अक्षित');
    expect(firstName(undefined)).toBe('');
  });
  it.each(['en', 'hi'] as const)('%s: every greeting is translated with the name', (lang) => {
    for (const g of ['morning', 'afternoon', 'evening', 'night']) {
      const s = i18n.getFixedT(lang)(`greet.${g}`, { name: 'Aarav' });
      expect(s).toContain('Aarav');
      if (lang === 'hi') expect(s).toMatch(/[\u0900-\u097F]/);
    }
  });
});

describe('timezone: everything follows the device LOCAL clock', () => {
  it('a UTC instant maps to the local hour (whatever TZ this run uses)', () => {
    const d = new Date(Date.UTC(2026, 9, 13, 12, 30));
    expect(timeTheme(d)).toBe(d.getHours() * 60 + d.getMinutes() >= 360 && d.getHours() < 18 ? 'day' : 'night');
    expect(greeting(d)).toBe(greeting(new Date(2026, 9, 13, d.getHours(), d.getMinutes())));
  });
  it('TZ of this run', () => { expect(typeof Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('string'); });
});

describe('WCAG AA in both themes', () => {
  it.each(['day', 'night'] as const)('%s: spec token text pairs ≥ 4.5', (n) => {
    for (const [f, b] of SPEC_TEXT_PAIRS) expect([f, b, contrast(tokens[n][f] as string, tokens[n][b] as string)]).toEqual([f, b, expect.any(Number)]);
    for (const [f, b] of SPEC_TEXT_PAIRS) expect(contrast(tokens[n][f] as string, tokens[n][b] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['day', 'night'] as const)('%s: app colour text pairs ≥ 4.5, control borders ≥ 3', (n) => {
    const t = THEMES[n] as Record<string, string>;
    for (const [f, b] of AA_TEXT_PAIRS) { const r = contrast(t[f], t[b]); if (r < 4.5) throw new Error(`${n} ${f} on ${b} = ${r.toFixed(2)}`); }
    for (const [f, b] of AA_UI_PAIRS) expect(contrast(t[f], t[b])).toBeGreaterThanOrEqual(3);
  });
  it('rules carried over: never white on day orange; night accent is not a text token', () => {
    expect(contrast('#FFFFFF', tokens.day.primary)).toBeLessThan(4.5);
    expect(tokens.day.onPrimary).not.toBe('#FFFFFF');
    expect(SPEC_TEXT_PAIRS.some(([f]) => f === 'accent')).toBe(false);
  });
  it('applyTheme swaps the live colours', () => {
    applyTheme('night'); expect(colors.bg).toBe('#0A0E1A'); expect(currentTheme()).toBe('night');
    applyTheme('day'); expect(colors.bg).toBe('#FFF4E2');
  });
});

describe('fonts: Mukta for Hindi in Night only', () => {
  it('hiFont', () => {
    expect(hiFont('night', 'hi', tokens.night.font).body).toEqual({ fontFamily: 'Mukta-Regular' });
    expect(hiFont('night', 'en', tokens.night.font).body).toEqual({ fontFamily: 'Mukta-Regular' }); // 1.4.22: Mukta is the Night body face
    expect(hiFont('day', 'hi', tokens.day.font).body).toEqual({ fontFamily: 'Hind-Regular' }); // Day body Hind (covers Devanagari)
    expect(hiFont('night', 'en', tokens.night.font).display).toEqual({ fontFamily: 'Teko-SemiBold', fontWeight: 'normal' });
    expect(hiFont('night', 'en', tokens.night.font).upper).toBe(true);
    expect(hiFont('night', 'hi', tokens.night.font).upper).toBe(false);
    expect(hiFont('night', 'hi', tokens.night.font).display).toEqual({ fontFamily: 'Mukta-ExtraBold', fontWeight: 'normal' });
    expect(tokens.night.font.score).toBe('Teko-SemiBold'); // score numerals stay Teko in Hindi too
    expect(tokens.day.font.score).toBe('Baloo2-ExtraBold'); // 1.4.22: Day score sticker in Baloo 2 800
  });
  it('bundled font files carry their OFL licence', () => {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../../../assets/fonts');
    expect(fs.readdirSync(root).sort()).toEqual(['baloo2', 'hind', 'mukta', 'teko']);
    for (const d of ['baloo2', 'hind', 'mukta', 'teko']) {
      expect(fs.readFileSync(path.join(root, d, 'OFL.txt'), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
      for (const f of fs.readdirSync(path.join(root, d))) expect(f).toMatch(/^(Mukta-(Regular|Bold|ExtraBold)\.ttf|Teko-SemiBold\.ttf|Baloo2-ExtraBold\.ttf|Hind-(Regular|SemiBold|Bold)\.ttf|OFL\.txt)$/);
    }
  });
});

describe('storage volleylive.theme.v1 (per user)', () => {
  it('parse / per-user lookup / fallback', () => {
    expect(parseStored('not json')).toEqual({});
    const s = parseStored(JSON.stringify({ setting: 'day', animate: false, users: { u1: { setting: 'night', animate: true } } }));
    expect(settingFor(s, 'u1')).toEqual({ setting: 'night', animate: true });
    expect(settingFor(s, 'u2')).toEqual({ setting: 'day', animate: false });
    expect(settingFor({}, null)).toEqual({ setting: 'auto', animate: true });
  });
});

// ---------- provider ----------
let clock = at(17, 59, 50).getTime();
const nowFn = () => clock;
let probe: ReturnType<typeof useTheme>;
function Probe() { probe = useTheme(); return <Text testID="probe">{probe.name}</Text>; }
function Live({ n }: { n: number }) { useLiveThemeHold(n); return null; }
const mount = async (uid = 'u1', extra?: React.ReactNode) => {
  const r = await render(<ThemeProvider uid={uid} nowFn={nowFn}>{() => <><Probe />{extra}</>}</ThemeProvider>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return r;
};
describe('ThemeProvider', () => {
  beforeEach(async () => { jest.useFakeTimers(); await AsyncStorage.clear(); clock = at(17, 59, 50).getTime(); _setReduceMotion(false); applyTheme('day'); });
  afterEach(() => { jest.useRealTimers(); });

  it('cold start: resolves before first paint with no animation; the 18:00 boundary plays the 1.4 s scene', async () => {
    const r = await mount();
    expect(r.getByTestId('probe').props.children).toBe('day');
    expect(r.queryByTestId(/theme-(scene|fade)/, H)).toBeNull();
    clock = at(18, 0, 0).getTime();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(r.getByTestId('theme-scene-night', H)).toBeTruthy();
    expect(r.getByTestId('probe').props.children).toBe('day'); // not yet covered
    await act(async () => { jest.advanceTimersByTime(coveredAt('night')); });
    expect(r.getByTestId('probe').props.children).toBe('night');
    await act(async () => { jest.advanceTimersByTime(SCENE_MS); });
    expect(r.queryByTestId('theme-scene-night', H)).toBeNull();
  });
  it('Reduce Motion: the boundary is a 250 ms fade', async () => {
    _setReduceMotion(true);
    const r = await mount();
    clock = at(18, 0, 0).getTime();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(r.getByTestId('theme-fade-night', H)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(r.getByTestId('probe').props.children).toBe('night');
  });
  it('Appearance change: fade, saved under volleylive.theme.v1 for this user; the animation switch is saved too', async () => {
    clock = at(12).getTime();
    const r = await mount('u7');
    await act(async () => { probe.setSetting('night'); });
    expect(r.getByTestId('theme-fade-night', H)).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(r.getByTestId('probe').props.children).toBe('night');
    await act(async () => { probe.setAnimate(false); });
    const saved = JSON.parse((await AsyncStorage.getItem(THEME_KEY))!);
    expect(saved.users.u7).toEqual({ setting: 'night', animate: false });
  });
  it('a stored setting applies on cold start without animation (per user)', async () => {
    clock = at(12).getTime();
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ users: { u9: { setting: 'night', animate: true } } }));
    const r = await mount('u9');
    expect(r.getByTestId('probe').props.children).toBe('night');
    expect(r.queryByTestId(/theme-(scene|fade)/, H)).toBeNull();
  });
  it('back to the foreground after the boundary: switches with no animation', async () => {
    let onChange: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((ev: string, cb: (s: string) => void) => { if (ev === 'change') onChange = cb; return { remove: () => {} }; }) as never);
    const r = await mount();
    clock = at(21).getTime(); // the phone slept through 18:00 (the timer did not fire)
    await act(async () => { onChange!('active'); });
    expect(r.getByTestId('probe').props.children).toBe('night');
    expect(r.queryByTestId(/theme-(scene|fade)/, H)).toBeNull();
    spy.mockRestore();
  });
  it('live scoring: the switch waits for the rally to end, then a 400 ms fade (never the scene)', async () => {
    const r = await mount('u1', <Live n={0} />);
    clock = at(18, 0, 0).getTime();
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(r.queryByTestId(/theme-(scene|fade)/, H)).toBeNull();
    expect(r.getByTestId('probe').props.children).toBe('day'); // pending while the rally runs
    await r.rerender(<ThemeProvider uid="u1" nowFn={nowFn}>{() => <><Probe /><Live n={1} /></>}</ThemeProvider>); // a point is recorded
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(r.getByTestId('theme-fade-night', H)).toBeTruthy();
    expect(r.queryByTestId('theme-scene-night', H)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(450); });
    expect(r.getByTestId('probe').props.children).toBe('night');
  });
});


describe('font licences shown in the app match the bundled files', () => {
  it('FONT_LICENSES text = OFL.txt', () => {
    const fs = require('fs'), path = require('path');
    const { FONT_LICENSES } = require('../../core/fontLicenses');
    for (const f of FONT_LICENSES) {
      const dir = path.join(__dirname, '../../../assets/fonts', f.dir);
      expect(f.text).toBe(fs.readFileSync(path.join(dir, 'OFL.txt'), 'utf8'));
      for (const file of f.files) expect(fs.existsSync(path.join(dir, file))).toBe(true);
    }
  });
});
