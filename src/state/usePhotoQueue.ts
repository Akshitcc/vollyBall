import { useEffect, useReducer } from 'react';
import { photoQueue, type QueueView } from '../services/photoQueue';

/** Live view of the offline photo queue for one match (re-renders on every queue change). */
export function usePhotoQueue(matchId: string): QueueView {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => photoQueue.subscribe(bump), []);
  return photoQueue.view(matchId);
}
