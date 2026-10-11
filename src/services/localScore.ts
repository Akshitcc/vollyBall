/**
 * 1.3.7 (F135-2): the scoring screen keeps unsynced rallies in AsyncStorage (`score-cache-<id>`).
 * Lists (Score tab, Home live cards) used to show the last SYNCED score while offline; withLocalScores
 * swaps in the newer local copy (pending and newer than the server's version) and re-computes the
 * summary from it, so the list matches what the scorer sees.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { computeState, summarize } from '../core/scoring';
import type { MatchEvent } from '../core/scoring';
import type { Match } from '../core/types';

export const scoreCacheKey = (id: string) => `score-cache-${id}`;
type Cached = { events: MatchEvent[]; savedAt: number; pending: boolean };

export function applyLocal(m: Match, cached: Cached | null): Match {
  if (!cached?.pending || !(cached.savedAt > m.updatedAt) || !Array.isArray(cached.events)) return m;
  const summary = summarize(computeState(m.rules, cached.events, m.firstServe));
  return { ...m, events: cached.events, summary: { ...m.summary, ...summary }, updatedAt: cached.savedAt };
}

export async function withLocalScores(list: Match[]): Promise<Match[]> {
  const live = list.filter((m) => m.status === 'live');
  if (!live.length) return list;
  let pairs: readonly [string, string | null][] = [];
  try {
    pairs = await AsyncStorage.multiGet(live.map((m) => scoreCacheKey(m.id)));
  } catch {
    return list;
  }
  const byKey = new Map(pairs);
  return list.map((m) => {
    const raw = m.status === 'live' ? byKey.get(scoreCacheKey(m.id)) : null;
    if (!raw) return m;
    try {
      return applyLocal(m, JSON.parse(raw) as Cached);
    } catch {
      return m;
    }
  });
}

/** `list` with local unsynced scores applied (re-checked whenever the list changes). */
export function useLocalScores(list: Match[] | undefined): Match[] | undefined {
  const [done, setDone] = useState<{ src: Match[]; value: Match[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (list) void withLocalScores(list).then((value) => alive && setDone({ src: list, value }));
    return () => {
      alive = false;
    };
  }, [list]);
  return list && done?.src === list ? done.value : list;
}
