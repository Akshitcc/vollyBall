import { useEffect, useState } from 'react';
import type { Unsubscribe } from '../services/backend';

/** Subscribe to a backend watcher; returns undefined while loading. */
export function useWatch<T>(subscribe: ((cb: (v: T) => void) => Unsubscribe) | null, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    if (!subscribe) return;
    setValue(undefined);
    return subscribe(setValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[]): { data: T | undefined; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!fn) return;
    let alive = true;
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}
