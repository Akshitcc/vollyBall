/**
 * In-process change bus. Routes publish after a successful commit; the
 * WebSocket hub forwards to subscribed clients. (Single instance; for several
 * API instances swap this for Redis pub/sub with the same interface.)
 */
import { EventEmitter } from 'node:events';

export interface LiveMessage {
  topic: string;
  /** `doc` carries the new document; `invalidate` tells clients to refetch. */
  type: 'doc' | 'invalidate' | 'deleted';
  data?: unknown;
}

export class LiveBus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(0);
  }
  publish(msg: LiveMessage) {
    this.ee.emit('msg', msg);
  }
  subscribe(fn: (m: LiveMessage) => void): () => void {
    this.ee.on('msg', fn);
    return () => this.ee.off('msg', fn);
  }
}

/** Topic names shared with the app's ApiBackend. */
export const topics = {
  match: (id: string) => `match:${id}`,
  matches: 'matches',
  photos: (matchId: string) => `photos:${matchId}`,
  team: (id: string) => `team:${id}`,
  teams: 'teams',
  profile: (uid: string) => `profile:${uid}`,
  challenges: 'challenges',
  tournament: (id: string) => `tournament:${id}`,
  tournaments: 'tournaments',
  courts: 'courts',
};
