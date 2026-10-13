import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { backend } from '../services/backend';
import type { RankingsResult } from '../services/backend/types';

/** Rankings (src/core/ranking.ts via the backend). `refreshKey` refetches when it changes. undefined = loading, null = failed. */
export function useRankings(uid: string, refreshKey: unknown = 0): RankingsResult | null | undefined {
  const [r, setR] = useState<RankingsResult | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    backend
      .getRankings(uid)
      .then((x) => alive && setR(x))
      .catch((e) => {
        console.warn('[rankings]', e?.message ?? e);
        if (alive) setR(null);
      });
    return () => {
      alive = false;
    };
  }, [uid, refreshKey]);
  return r;
}

/** 1.4.17 (QA V1416-2): the refetch key Profile uses – one entry per match of mine, changing with its updatedAt. */
export const myMatchesKey = (matches: readonly { id: string; updatedAt?: unknown }[] | null | undefined): string =>
  (matches ?? []).map((m) => `${m.id}:${String(m.updatedAt ?? '')}`).join(',');

/**
 * 1.4.17 (QA V1416-2): rankings for a screen that doesn't watch my matches itself (Home). Before, Home fetched once on
 * mount and the tab stays mounted, so a confirm / repair / finish never reached it until a reload. Now it refetches
 * like Profile – whenever one of my matches changes (demo, Firebase and API all push watchMyMatches) – and when the
 * screen regains focus (covers changes to matches I'm not in that still move my rank).
 */
export function useMyRankings(uid: string): RankingsResult | null | undefined {
  const [key, setKey] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => backend.watchMyMatches(uid, (ms) => setKey(myMatchesKey(ms))), [uid]);
  const onFocus = useCallback(() => setFocusTick((n) => n + 1), []);
  if (typeof useFocusEffect === 'function') useFocusEffect(onFocus);
  return useRankings(uid, `${key}|${focusTick}`);
}
