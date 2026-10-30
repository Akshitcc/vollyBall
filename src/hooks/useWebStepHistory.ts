/**
 * 1.5.9 (Tester F158-9): on web the New Match steps get browser history entries, so the browser's Back on step 3
 * goes to step 2 (then step 1, then out of the screen) instead of leaving the form.
 *
 * Each step forward pushes an entry with the SAME url and the router's own entry id (expo-router's memory history
 * keys its entries by `history.state.id`), plus `vlStep` / `vlDepth`. Going Back to one of them fires popstate; the
 * router finds its own entry for the same path and keeps the screen, and this hook sets the step from the entry.
 * The in-app back (header arrow) and the stepper walk the same entries (history.go), so the browser and the app
 * agree; `unwind()` pops them before the screen is replaced (create), so Back from the new match never lands on a
 * stale step entry. Native: a no-op (Android back is the screen's BackHandler).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';

type H = { state: Record<string, unknown> | null; pushState(s: unknown, t: string, u?: string): void; replaceState(s: unknown, t: string, u?: string): void; go(n: number): void };
type W = { history: H; location: { href: string }; addEventListener(e: string, f: () => void): void; removeEventListener(e: string, f: () => void): void };

/** Pure planning (tested): the history move for going from the current entry stack to `target`. */
export function planStepMove(stack: readonly number[], target: number): { go: number } | { push: true } | { replace: true } {
  const d = stack.length - 1;
  if (target > stack[d]) return { push: true };
  for (let i = d - 1; i >= 0; i--) if (stack[i] === target) return { go: i - d };
  return { replace: true };
}

export function useWebStepHistory<S extends number>(step: S, setStep: (s: S) => void, enabled = Platform.OS === 'web') {
  const w = (enabled && typeof window !== 'undefined' ? (window as unknown as W) : null);
  const base = useRef<unknown>(null);
  const stack = useRef<number[]>([0]);
  const cur = useRef<number>(step);
  cur.current = step;
  const ours = () => !!w && base.current != null && (w.history.state?.id ?? null) === base.current;
  useEffect(() => {
    if (!w) return;
    base.current = w.history.state?.id ?? null;
    const onPop = () => {
      const st = w.history.state;
      if (!st || base.current == null || st.id !== base.current) return; // another screen's entry
      const depth = typeof st.vlDepth === 'number' ? st.vlDepth : 0;
      const s = typeof st.vlStep === 'number' ? st.vlStep : 0;
      stack.current = stack.current.slice(0, depth + 1);
      if (stack.current.length < depth + 1) stack.current.push(s);
      stack.current[depth] = s;
      setStep(s as S);
    };
    w.addEventListener('popstate', onPop);
    return () => w.removeEventListener('popstate', onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Move to `target` (forward = a new entry; back = history.go to the matching entry). False = not handled. */
  const move = useCallback((target: S): boolean => {
    if (!w || !ours()) return false;
    stack.current[stack.current.length - 1] = cur.current; // in sync with the real step
    const plan = planStepMove(stack.current, target);
    if ('push' in plan) {
      stack.current = [...stack.current, target];
      w.history.pushState({ ...(w.history.state ?? {}), vlStep: target, vlDepth: stack.current.length - 1 }, '', w.location.href);
      setStep(target);
    } else if ('go' in plan) {
      w.history.go(plan.go); // popstate sets the step
    } else {
      stack.current[stack.current.length - 1] = target;
      w.history.replaceState({ ...(w.history.state ?? {}), vlStep: target }, '', w.location.href);
      setStep(target);
    }
    return true;
  }, [setStep]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pops this screen's step entries (before router.replace), resolves once the browser is back on the base entry. */
  const unwind = useCallback(async (): Promise<void> => {
    const d = stack.current.length - 1;
    if (!w || d <= 0 || !ours()) return;
    await new Promise<void>((done) => {
      const t = setTimeout(done, 400);
      const once = () => { clearTimeout(t); w.removeEventListener('popstate', once); done(); };
      w.addEventListener('popstate', once);
      w.history.go(-d);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => ({ move, unwind }), [move, unwind]);
}
