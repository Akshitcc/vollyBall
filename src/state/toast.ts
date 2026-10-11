/**
 * App-wide toast: a short message that survives navigation (e.g. "Challenge sent" shown on the
 * screen we land on after leaving the form). ToastHost in the root layout renders it.
 */
import { useEffect, useState } from 'react';

type Listener = (msg: string | null) => void;
const listeners = new Set<Listener>();
let current: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function set(msg: string | null) {
  current = msg;
  listeners.forEach((l) => l(msg));
}

export function showToast(msg: string, ms = 3500) {
  if (timer) clearTimeout(timer);
  set(msg);
  timer = setTimeout(() => {
    timer = null;
    set(null);
  }, ms);
}

export function hideToast() {
  if (timer) clearTimeout(timer);
  timer = null;
  set(null);
}

export function useToast(): string | null {
  const [msg, setMsg] = useState(current);
  useEffect(() => {
    listeners.add(setMsg);
    setMsg(current);
    return () => {
      listeners.delete(setMsg);
    };
  }, []);
  return msg;
}
