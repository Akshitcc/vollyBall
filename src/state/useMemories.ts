import { useEffect, useState } from 'react';
import type { MatchPhoto } from '../core/types';
import { backend } from '../services/backend';

/** Photos from the matches this user played in ("memories" on the profile). */
export function useMemories(uid: string, refreshKey: unknown = 0): MatchPhoto[] {
  const [list, setList] = useState<MatchPhoto[]>([]);
  useEffect(() => {
    let alive = true;
    backend
      .listMemories(uid)
      .then((x) => alive && setList(x))
      .catch((e) => console.warn('[memories]', e?.message ?? e));
    return () => {
      alive = false;
    };
  }, [uid, refreshKey]);
  return list;
}
