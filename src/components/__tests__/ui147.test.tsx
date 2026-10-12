/**
 * 1.4.7 UI (QA V146): V146-6 (on the web the keyboard only shrinks window.visualViewport, so reveal() measures the
 * node on screen against the visual viewport and scrolls by the difference; native keeps the layout path), V146-4
 * (the Firebase read budget for the admin list's extra queries and the profile lookups; errors propagate) and the
 * EN/HI texts for the V146-2/3 refusals.
 */
import { render } from '@testing-library/react-native';
import React, { useContext, useEffect } from 'react';
import { Platform, ScrollView } from 'react-native';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../services/backend', () => ({ backend: {} }));

import { KeyboardAwareScreen, ScrollRevealContext, webHiddenBelow, webRevealDelta } from '../KeyboardAwareScreen';

describe('V146-6: web keyboard reveal uses the visual viewport', () => {
  it('webRevealDelta scrolls a node under the keyboard up into the visible area', () => {
    // 800 px layout viewport, keyboard leaves 0..450 visible
    const vv = { height: 450, offsetTop: 0 };
    expect(webRevealDelta({ top: 500, bottom: 560 }, vv, 24)).toBe(134); // 560 + 24 - 450
    expect(webRevealDelta({ top: 100, bottom: 160 }, vv, 24)).toBe(0);
    // the browser itself panned the visual viewport by 200 px
    expect(webRevealDelta({ top: 500, bottom: 560 }, { height: 450, offsetTop: 200 }, 24)).toBe(0);
    // never pushes the node's top out above the visible area
    expect(webRevealDelta({ top: 60, bottom: 700 }, vv, 24)).toBe(52);
    // above the visible area: scroll back down
    expect(webRevealDelta({ top: -40, bottom: 10 }, vv, 24)).toBe(-48);
  });
  it('V146-12: no keyboard, but a sticky footer under the scroll view – the scroll view clips the visible area', () => {
    // 640 px window, the scroll view ends at 520 (footer below); the found-player card at 470..560
    expect(webRevealDelta({ top: 470, bottom: 560 }, { height: 640, offsetTop: 0 }, 24, 8, { top: 100, bottom: 520 })).toBe(64);
    expect(webRevealDelta({ top: 300, bottom: 400 }, { height: 640, offsetTop: 0 }, 24, 8, { top: 100, bottom: 520 })).toBe(0);
  });
  it('webHiddenBelow is the part of the page under the keyboard', () => {
    expect(webHiddenBelow(800, { height: 450, offsetTop: 0 })).toBe(350);
    expect(webHiddenBelow(800, { height: 790, offsetTop: 0 })).toBe(0);
    expect(webHiddenBelow(800, null)).toBe(0);
  });
  it('on the web reveal() scrolls by the on-screen difference (not the layout viewport)', async () => {
    const osDesc = Object.getOwnPropertyDescriptor(Platform, 'OS')!;
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: () => void }, 'scrollTo').mockImplementation(() => {});
    const w = window as unknown as { innerHeight: number; visualViewport?: unknown };
    const had = { innerHeight: w.innerHeight, visualViewport: w.visualViewport };
    Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true, writable: true });
    Object.defineProperty(w, 'visualViewport', { value: { height: 450, offsetTop: 0, addEventListener: () => {}, removeEventListener: () => {} }, configurable: true, writable: true });
    const el = { getBoundingClientRect: () => ({ top: 500, bottom: 560 }) };
    function Probe() {
      const reveal = useContext(ScrollRevealContext);
      useEffect(() => reveal(el, 24), [reveal]);
      return null;
    }
    try {
      await render(<KeyboardAwareScreen><Probe /></KeyboardAwareScreen>);
      expect(scrollTo).toHaveBeenCalledWith({ y: 134, animated: true });
    } finally {
      Object.defineProperty(Platform, 'OS', osDesc);
      Object.defineProperty(w, 'innerHeight', { value: had.innerHeight, configurable: true, writable: true });
      Object.defineProperty(w, 'visualViewport', { value: had.visualViewport, configurable: true, writable: true });
      scrollTo.mockRestore();
    }
  });
});

describe('V146-4: the Firebase read budget', () => {
  // the helpers live in readBudget.ts (no Firebase imports); firebaseBackend re-exports and uses them
  const fb = () => require('../../services/backend/readBudget') as typeof import('../../services/backend/readBudget');
  it('pagedReads stays within the tier share and propagates errors', async () => {
    const { pagedReads, newReadBudget, RANKING_READ } = fb();
    const budget = newReadBudget();
    const asked: number[] = [];
    const docs = await pagedReads<number>(async (n) => (asked.push(n), Array.from({ length: n }, (_, i) => i)), () => RANKING_READ.WORST_DOC_BYTES, RANKING_READ.MAX_FLAGGED, budget, 'flagged');
    const share = Math.floor((RANKING_READ.MAX_BYTES - RANKING_READ.PROFILE_RESERVE) * RANKING_READ.SHARE.flagged);
    expect(docs.length * RANKING_READ.WORST_DOC_BYTES).toBeLessThanOrEqual(share);
    expect(docs.length).toBeLessThanOrEqual(RANKING_READ.MAX_FLAGGED);
    expect(budget.bytes).toBe(RANKING_READ.MAX_BYTES - docs.length * RANKING_READ.WORST_DOC_BYTES);
    await expect(pagedReads(async () => { throw Object.assign(new Error('missing index'), { code: 'failed-precondition' }); }, () => 1, 100, newReadBudget(), 'flagged')).rejects.toThrow('missing index');
  });
  it('budgetedProfiles reads in chunks only while the budget holds, and propagates errors', async () => {
    const { budgetedProfiles, RANKING_READ } = fb();
    const ids = Array.from({ length: 95 }, (_, i) => `u${i}`);
    const budget = { bytes: RANKING_READ.WORST_PROFILE_BYTES * 65 };
    const r = await budgetedProfiles(ids, async (part) => part.map((id) => ({ id, bytes: RANKING_READ.WORST_PROFILE_BYTES })), budget);
    expect(r.found.size).toBe(60);
    expect(r.unchecked).toEqual(ids.slice(60));
    await expect(budgetedProfiles(['x'], async () => { throw new Error('permission-denied'); }, { bytes: 1e9 })).rejects.toThrow('permission-denied');
  });
  it('no read in listFlagged / markUnknownPlayers swallows its error any more', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/backend/firebaseBackend.ts'), 'utf8');
    const body = (name: string) => src.slice(src.indexOf(`async ${name}(`), src.indexOf('\n  }\n', src.indexOf(`async ${name}(`)));
    for (const f of ['listFlagged', 'markUnknownPlayers']) {
      expect(body(f)).not.toMatch(/catch/);
      expect(body(f)).toMatch(/budget/i);
    }
  });
});

describe('V146-2/3 texts (EN/HI)', () => {
  it('both refusals and the hint exist in both languages', () => {
    for (const L of [en, hi] as unknown as { errors: { codes: Record<string, string> }; abandon: Record<string, string> }[]) {
      expect(L.errors.codes.handover_no_verdict).toBeTruthy();
      expect(L.errors.codes.reassign_verdict_captain).toBeTruthy();
      expect(L.abandon.handoverHintVerdict).toBeTruthy();
    }
    expect(en.errors.codes.reassign_verdict_captain).toMatch(/team/);
  });
});

describe('V146-7: the abandoned-at formatter (score = current set points, sets separately)', () => {
  const { abandonedLineOf } = require('../AbandonPanel');
  const i18n = require('../../i18n').default;
  const at = (o: Record<string, unknown>) => ({ setsA: 0, setsB: 0, sets: [], done: [], setNo: 1, current: { a: 0, b: 0 }, ...o });
  it.each([
    ['en', 'Abandoned at 2–8 in set 1 · sets 0–0', 'Abandoned at 3–1 in set 2 · sets 1–0 (25‑20)', 'Abandoned after set 2 · sets 1–1 (25‑20, 18‑25)', 'Abandoned before the first rally'],
    ['hi', 'सेट 1 में 2–8 पर छोड़ा गया · सेट 0–0', 'सेट 2 में 3–1 पर छोड़ा गया · सेट 1–0 (25‑20)', 'सेट 2 के बाद छोड़ा गया · सेट 1–1 (25‑20, 18‑25)', 'पहली रैली से पहले छोड़ा गया'],
  ])('%s', async (lang, first, second, between, none) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    // the Tester's card: set 1 at 2–8, no set won – 1.4.6 printed "Abandoned at 0–0 · sets 2-8"
    expect(abandonedLineOf(at({ sets: [{ a: 2, b: 8 }], current: { a: 2, b: 8 } }), t)).toBe(first);
    expect(abandonedLineOf(at({ setsA: 1, sets: [{ a: 25, b: 20 }, { a: 3, b: 1 }], done: [{ a: 25, b: 20 }], setNo: 2, current: { a: 3, b: 1 } }), t)).toBe(second);
    expect(abandonedLineOf(at({ setsA: 1, setsB: 1, sets: [{ a: 25, b: 20 }, { a: 18, b: 25 }], done: [{ a: 25, b: 20 }, { a: 18, b: 25 }], setNo: 3 }), t)).toBe(between);
    expect(abandonedLineOf(at({}), t)).toBe(none);
  });
  it('core abandonedAt gives the current set and its points', () => {
    const { abandonedAt } = require('../../core/abandon');
    const { addPoint } = require('../../core/scoring');
    const { INDOOR_RULES } = require('../../core/rules');
    const rules = { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null };
    let ev: unknown[] = [];
    for (const s of 'AABBBBBBBB') ev = addPoint(rules, ev as never, s as 'A' | 'B', { at: 1 });
    expect(abandonedAt({ rules, events: ev, firstServe: 'A' })).toMatchObject({ setsA: 0, setsB: 0, setNo: 1, current: { a: 2, b: 8 }, done: [] });
  });
});

describe('V146-8: times are epoch ms shown in the device zone, labelled (runs in every zone under test:tz)', () => {
  const { formatWhenZoneT, zoneLabel } = require('../../i18n/format');
  const i18n = require('../../i18n').default;
  // the Tester's abandon: 12 Oct 2026 07:49 IST = 02:19 UTC
  const T = Date.UTC(2026, 9, 12, 2, 19);
  const WANT: Record<string, [string, string]> = {
    UTC: ['2:19', 'UTC'],
    'Asia/Kolkata': ['7:49', 'IST'],
    'Asia/Colombo': ['7:49', 'UTC+5:30 (Colombo)'], // 1.4.8 (V147-6): +5:30 but not India – not "IST"
    'America/Los_Angeles': ['7:19', 'PDT'], // 1.4.8 (V147-6): the zone's own abbreviation
    'Pacific/Kiritimati': ['4:19', 'UTC+14 (Kiritimati)'], // no abbreviation: offset + the zone's city
  };
  it('formats the same instant in the device zone with its label', async () => {
    await i18n.changeLanguage('en');
    const z = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const s: string = formatWhenZoneT(T);
    const d = new Date(T);
    const hm = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
    expect(s).toContain(hm);
    expect(s.endsWith(` ${zoneLabel(T)}`)).toBe(true);
    if (WANT[z]) {
      expect(s).toContain(WANT[z][0]);
      expect(zoneLabel(T)).toBe(WANT[z][1]);
    }
  });
  it('a stored ISO string without a zone would be wrong; the app only passes epoch ms (Date.parse of …Z = the instant)', () => {
    expect(Date.parse('2026-10-12T02:19:00Z')).toBe(T);
  });
});
