import { useEffect, useState } from 'react';
import type { UserProfile } from '../core/types';
import { backend } from '../services/backend';

const cache = new Map<string, UserProfile>();

/** Load (and cache) profiles for a list of uids. */
export function useProfiles(ids: string[] | undefined): Record<string, UserProfile> {
  const key = (ids ?? []).slice().sort().join(',');
  const [map, setMap] = useState<Record<string, UserProfile>>(() => {
    const m: Record<string, UserProfile> = {};
    (ids ?? []).forEach((i) => cache.has(i) && (m[i] = cache.get(i)!));
    return m;
  });
  useEffect(() => {
    if (!ids?.length) return;
    let alive = true;
    backend.getProfiles(ids).then((list) => {
      list.forEach((p) => cache.set(p.id, p));
      if (!alive) return;
      const m: Record<string, UserProfile> = {};
      ids.forEach((i) => cache.has(i) && (m[i] = cache.get(i)!));
      setMap(m);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}
