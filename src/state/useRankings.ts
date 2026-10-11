import { useEffect, useState } from 'react';
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
