/**
 * 1.4.21 Day/Night theme provider – Designer spec §1/§6 (volleylive-design/daynight/daynight-spec.md), adapted:
 *  - Auto is time-based only (06:00–17:59 Day) – no OS dark rule (Akshit; flagged in RELEASE-1.4.21).
 *  - Setting stored in AsyncStorage `volleylive.theme.v1` as { setting, animate, users: { <uid>: { setting, animate } } }
 *    – per user on this device (the top-level pair is the signed-out / last-used default).
 *  - Boundary (06:00 / 18:00) → the 1.4 s "Sunset → Floodlight" scene; Reduce Motion or the animation switch off → 250 ms
 *    fade; a change in Appearance → 250 ms fade; cold start / back to foreground → no animation.
 *  - Live scoring: `holdTransitions(true)` on the screen; a switch waits for the rally to end (`rallyEnded()`), then
 *    a 400 ms fade only – the screen re-renders with the new tokens but is NOT remounted (its rally state stays);
 *    the full tree refresh happens without animation when the scorer leaves.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, View } from 'react-native';
import { reduceMotionNow } from '../hooks/useReduceMotion';
import { applyTheme } from './index';
import { isThemeSetting, msToNextBoundary, msToNextMinute, resolveTheme, type ThemeName, type ThemeSetting } from './resolve';
import { ThemeTransition, type TransitionHandle, type TransitionMode } from './ThemeTransition';
import { tokens, type Tokens } from './tokens';

export const THEME_KEY = 'volleylive.theme.v1';
export const LIVE_RALLY_GRACE_MS = 600;
type Stored = { setting?: ThemeSetting; animate?: boolean; users?: Record<string, { setting?: ThemeSetting; animate?: boolean }> };

export type ThemeCtx = {
  name: ThemeName; t: Tokens; setting: ThemeSetting; setSetting(s: ThemeSetting): void; animate: boolean; setAnimate(b: boolean): void;
  holdTransitions(hold: boolean): void; rallyEnded(): void; now: Date; generation: number;
};
const Ctx = createContext<ThemeCtx>({
  name: 'day', t: tokens.day, setting: 'auto', setSetting: () => {}, animate: true, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0,
});
export const useTheme = () => useContext(Ctx);
/** 1.4.22: exposed so screen tests can render a component in a fixed theme. */
export const ThemeContext = Ctx;

export function parseStored(v: string | null): Stored {
  try { const s = v ? JSON.parse(v) : {}; return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
export function settingFor(s: Stored, uid: string | null | undefined): { setting: ThemeSetting; animate: boolean } {
  const u = uid ? s.users?.[uid] : undefined;
  const setting = isThemeSetting(u?.setting) ? u!.setting! : isThemeSetting(s.setting) ? s.setting : 'auto';
  const animate = typeof u?.animate === 'boolean' ? u.animate : typeof s.animate === 'boolean' ? s.animate : true;
  return { setting, animate };
}

export function ThemeProvider({ uid, children, nowFn = Date.now, readTimeoutMs = 300 }: { uid?: string | null; children: (generation: number) => React.ReactNode; nowFn?: () => number; readTimeoutMs?: number }) {
  const [ready, setReady] = useState(false);
  const [setting, setSettingS] = useState<ThemeSetting>('auto');
  const [animate, setAnimateS] = useState(true);
  const [name, setName] = useState<ThemeName>(() => resolveTheme('auto', new Date(nowFn())));
  const [generation, setGeneration] = useState(0);
  const [, setSoft] = useState(0);
  const [now, setNow] = useState(() => new Date(nowFn()));
  const nameRef = useRef(name);
  const pending = useRef<ThemeName | null>(null);
  const hold = useRef(false);
  const remountOnLeave = useRef(false);
  const fx = useRef<TransitionHandle>(null);
  const stored = useRef<Stored>({});

  /** Swap tokens. `remount` refreshes every screen (key change); on Live it only re-renders. */
  const swap = useCallback((next: ThemeName, remount: boolean) => {
    nameRef.current = next;
    applyTheme(next);
    setName(next);
    if (remount) setGeneration((g) => g + 1);
    else { remountOnLeave.current = true; setSoft((n) => n + 1); }
    AccessibilityInfo.announceForAccessibility?.(next === 'night' ? 'Night theme on' : 'Day theme on');
  }, []);

  const apply = useCallback((next: ThemeName, mode: TransitionMode | 'none') => {
    if (next === nameRef.current) { pending.current = null; return; }
    if (hold.current && mode !== 'none') { pending.current = next; return; } // live scoring: wait for the rally to end
    pending.current = null;
    let m = mode;
    if (m === 'scene' && (reduceMotionNow() || !animate)) m = 'fade';
    if (m === 'none' || !fx.current) return swap(next, true);
    fx.current.play(next, m, () => swap(next, true));
  }, [animate, swap]);

  // cold start: read the stored setting before first paint (max readTimeoutMs, then a provisional Auto) – no animation.
  // 1.4.22 (QA V1421-3): a slow read is no longer dropped. When it lands after the timeout, the saved choice is applied
  // (unless the user already changed it in Appearance meanwhile) and the full saved map is kept for later writes.
  const touched = useRef(false);
  useEffect(() => {
    let alive = true, provisional = false;
    touched.current = false;
    const adopt = (s: Stored, first: boolean) => {
      stored.current = s;
      if (!first && touched.current) return; // the user already chose something this session
      const { setting: st, animate: an } = settingFor(s, uid);
      setSettingS(st); setAnimateS(an);
      const next = resolveTheme(st, new Date(nowFn()));
      if (first || next !== nameRef.current) { nameRef.current = next; applyTheme(next); setName(next); setGeneration((g) => g + 1); }
      setReady(true);
    };
    const timer = setTimeout(() => { if (!alive) return; provisional = true; adopt({}, true); }, readTimeoutMs);
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => { if (!alive) return; clearTimeout(timer); adopt(parseStored(v), !provisional); })
      .catch(() => { if (!alive) return; clearTimeout(timer); if (!provisional) adopt({}, true); });
    return () => { alive = false; clearTimeout(timer); };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // the boundary timer (06:00 / 18:00) → scene
  useEffect(() => {
    if (!ready || setting !== 'auto') return;
    const id = setTimeout(() => apply(resolveTheme('auto', new Date(nowFn())), 'scene'), msToNextBoundary(new Date(nowFn())));
    return () => clearTimeout(id);
  }, [ready, setting, name, apply, nowFn]);
  // the greeting clock (every whole minute)
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => { const d = new Date(nowFn()); setNow(d); id = setTimeout(tick, msToNextMinute(d)); };
    id = setTimeout(tick, msToNextMinute(new Date(nowFn())));
    return () => clearTimeout(id);
  }, [nowFn]);
  // back to the foreground (clock / zone / DST changes too): re-resolve without animation
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setNow(new Date(nowFn()));
      if (!hold.current) apply(resolveTheme(setting, new Date(nowFn())), 'none');
      else pending.current = resolveTheme(setting, new Date(nowFn())) === nameRef.current ? null : resolveTheme(setting, new Date(nowFn()));
    });
    return () => sub?.remove?.();
  }, [setting, apply, nowFn]);

  // 1.4.22 (QA V1421-3): writes are per account and merge with what is on the device right now (re-read before the
  // write), so one account's change never drops another account's saved choice – even after a slow cold-start read.
  const persist = useCallback((s: ThemeSetting, a: boolean) => {
    touched.current = true;
    const merge = (base: Stored): Stored => {
      if (!uid) return { ...base, setting: s, animate: a };
      return { ...base, users: { ...(base.users ?? {}), [uid]: { setting: s, animate: a } } };
    };
    stored.current = merge(stored.current);
    void AsyncStorage.getItem(THEME_KEY)
      .then((v) => { const next = merge(parseStored(v)); stored.current = next; return AsyncStorage.setItem(THEME_KEY, JSON.stringify(next)); })
      .catch(() => {});
  }, [uid]);
  const setSetting = useCallback((s: ThemeSetting) => { setSettingS(s); persist(s, animate); apply(resolveTheme(s, new Date(nowFn())), 'fade'); }, [animate, apply, persist, nowFn]);
  const setAnimate = useCallback((a: boolean) => { setAnimateS(a); persist(setting, a); }, [setting, persist]);
  const holdTransitions = useCallback((h: boolean) => {
    hold.current = h;
    if (!h) {
      if (pending.current) { const p = pending.current; pending.current = null; swap(p, true); return; } // left Live: no animation
      if (remountOnLeave.current) { remountOnLeave.current = false; setGeneration((g) => g + 1); }
    }
  }, [swap]);
  const rallyEnded = useCallback(() => {
    if (!pending.current) return;
    setTimeout(() => {
      const p = pending.current;
      if (!p || p === nameRef.current) { pending.current = null; return; }
      pending.current = null;
      if (fx.current && !reduceMotionNow()) fx.current.play(p, 'live', () => swap(p, false));
      else if (fx.current) fx.current.play(p, 'fade', () => swap(p, false));
      else swap(p, false);
    }, LIVE_RALLY_GRACE_MS);
  }, [swap]);

  const value = useMemo<ThemeCtx>(() => ({ name, t: tokens[name], setting, setSetting, animate, setAnimate, holdTransitions, rallyEnded, now, generation }),
    [name, setting, setSetting, animate, setAnimate, holdTransitions, rallyEnded, now, generation]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: tokens[name].bg }} testID="theme-loading" />;
  return (
    <Ctx.Provider value={value}>
      {children(generation)}
      <ThemeTransition ref={fx} />
    </Ctx.Provider>
  );
}

/** Live scoring: hold theme switches while the screen is open; call `rallyEnded()` after each recorded point. */
export function useLiveThemeHold(pointCount: number) {
  const { holdTransitions, rallyEnded } = useTheme();
  useEffect(() => { holdTransitions(true); return () => holdTransitions(false); }, [holdTransitions]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } rallyEnded(); }, [pointCount, rallyEnded]);
}
