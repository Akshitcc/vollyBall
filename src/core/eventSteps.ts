import type { MatchEvent } from './scoring';

/**
 * How far the event log may move in ONE Firestore write (firestore.rules eventsStepOk, QA G1).
 * The rules can't loop over the log, so each write may only:
 *  - append MAX_APPEND_PER_WRITE (1) event, shape-checked at its index (more per write would
 *    not fit the rules' expression budget on a 12-a-side finishing write),
 *  - undo exactly the last event, or
 *  - change the player credit / shot type of one of the last CREDIT_EDIT_WINDOW events
 *    (same type, side and time).
 * A bigger change (a log restored after a long time offline, several undos at once) is written as a
 * sequence of such steps (planEventSteps). The API server replays the whole log instead.
 */
export const MAX_APPEND_PER_WRITE = 1;
export const CREDIT_EDIT_WINDOW = 3;

/** Firestore compares maps by value; undefined keys are never stored. */
function canon(e: unknown): string {
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    const o = e as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  return JSON.stringify(e);
}
export function sameEvent(a: MatchEvent, b: MatchEvent): boolean {
  return canon(a) === canon(b);
}
function samePrefix(a: readonly MatchEvent[], b: readonly MatchEvent[], n: number): boolean {
  for (let i = 0; i < n; i++) if (!sameEvent(a[i], b[i])) return false;
  return true;
}
const sameRally = (a: MatchEvent, b: MatchEvent) => a.type === b.type && a.side === b.side && a.at === b.at;

/** True when going from `o` to `n` is one step the rules accept. */
export function isSingleStep(o: readonly MatchEvent[], n: readonly MatchEvent[]): boolean {
  const os = o.length;
  const ns = n.length;
  if (ns > os) return ns - os <= MAX_APPEND_PER_WRITE && samePrefix(n, o, os);
  if (ns === os - 1) return samePrefix(n, o, ns);
  if (ns === os && ns > 0) {
    const keep = Math.max(0, ns - CREDIT_EDIT_WINDOW);
    if (!samePrefix(n, o, keep)) return false;
    for (let i = keep; i < ns; i++) if (!sameRally(n[i], o[i])) return false;
    return true;
  }
  return false;
}

/**
 * The logs to write, in order, to get from `o` to `n` one rules-accepted step at a time (the last
 * one is `n`). Empty when nothing changed.
 */
export function planEventSteps(o: readonly MatchEvent[], n: readonly MatchEvent[]): MatchEvent[][] {
  if (o.length === n.length && samePrefix(n, o, n.length)) return [];
  if (isSingleStep(o, n)) return [n.slice()];
  let c = 0;
  while (c < o.length && c < n.length && sameEvent(o[c], n[c])) c++;
  const steps: MatchEvent[][] = [];
  for (let k = o.length - 1; k >= c; k--) steps.push(o.slice(0, k)); // undo back to the common part
  for (let k = c; k < n.length; ) {
    k = Math.min(n.length, k + MAX_APPEND_PER_WRITE);
    steps.push(n.slice(0, k));
  }
  if (steps.length === 0 || steps[steps.length - 1].length !== n.length) steps.push(n.slice());
  return steps;
}
