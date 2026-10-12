/**
 * 1.4.0 (QA V139-7): "something is open" – the in-app dialog, any modal (components/AppModal) or a pending
 * result flow (the Player of the Match picker). The review prompt waits until nothing is open, so it never
 * pops up over the picker (a stray tap there picked the wrong player in 1.3.8).
 */
import { useEffect } from 'react';
import { dialogOpen, onDialogChange } from './dialog';

const holders = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
onDialogChange(notify);

export function uiBusy(): boolean {
  return holders.size > 0 || dialogOpen();
}

/** Marks the UI busy until the returned release is called. */
export function holdUi(): () => void {
  const k = Symbol('hold');
  holders.add(k);
  notify();
  return () => {
    if (holders.delete(k)) notify();
  };
}

/** Calls `cb` once the UI is not busy (at once if it already isn't). Returns a cancel function. */
export function whenUiIdle(cb: () => void): () => void {
  if (!uiBusy()) {
    cb();
    return () => undefined;
  }
  const l = () => {
    if (uiBusy()) return;
    listeners.delete(l);
    cb();
  };
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Holds the UI busy while `active` (a modal while visible, a picker while shown). */
export function useHoldUi(active = true) {
  useEffect(() => (active ? holdUi() : undefined), [active]);
}

/** Renders nothing; marks the UI busy while mounted. */
export function HoldUi() {
  useHoldUi(true);
  return null;
}
