/**
 * Reduce Motion (Tester 1.2.0, design-spec §6): true when the user asked the OS for less motion –
 * AccessibilityInfo.isReduceMotionEnabled() on Android/iOS, `prefers-reduced-motion: reduce` on web.
 * Animations then swap scale/translate for short opacity fades (or nothing); haptics stay.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

type MQ = { matches: boolean; addEventListener?: (e: 'change', f: (x: { matches: boolean }) => void) => void; removeEventListener?: (e: 'change', f: (x: { matches: boolean }) => void) => void };

function webQuery(): MQ | null {
  const w = globalThis as { matchMedia?: (q: string) => MQ };
  return Platform.OS === 'web' && typeof w.matchMedia === 'function' ? w.matchMedia('(prefers-reduced-motion: reduce)') : null;
}

let current = webQuery()?.matches ?? false;
const listeners = new Set<(v: boolean) => void>();
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  const set = (v: boolean) => {
    current = v;
    listeners.forEach((l) => l(v));
  };
  const mq = webQuery();
  if (mq) {
    set(mq.matches);
    mq.addEventListener?.('change', (e) => set(e.matches));
    return;
  }
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then(set)
    .catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', set);
}

/** Current value without a component (e.g. inside an event handler). */
export const reduceMotionNow = () => current;

export function useReduceMotion(): boolean {
  const [v, setV] = useState(current);
  useEffect(() => {
    hook();
    listeners.add(setV);
    setV(current);
    return () => void listeners.delete(setV);
  }, []);
  return v;
}

/** Tests only. */
export function _setReduceMotion(v: boolean) {
  current = v;
  listeners.forEach((l) => l(v));
}
