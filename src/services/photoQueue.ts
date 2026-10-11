/**
 * Live match photos: upload in place, queue offline, retry when back online.
 *
 * Every photo is written to the AsyncStorage queue first, then uploaded. A failure that retrying
 * can fix (no network, timeout, server busy) keeps it queued with a growing delay (core/uploadQueue
 * retryDelay); the queue is also retried when the app comes back to the foreground and, on web,
 * when the browser reports it is online again. A refused or invalid photo is dropped with a
 * translated message. The queue survives app restarts (native file URIs from the camera / picker
 * live in the app's cache; a web blob: URL does not survive a reload, so such an item fails at once
 * with photo_unreadable and is dropped, QA NB-P4).
 *
 * Retest 1.1.0: the queue belongs to the signed-in account. Only items queued by the current user
 * are uploaded (setUser, from AuthContext); signing out clears the queue (services/session.ts), and
 * items of another account are dropped when a different user signs in. Each item's id is sent as
 * its idempotency key, so a retry after a lost response never creates a second photo.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { backend } from './backend';
import { connectivity, isNetworkError } from './connectivity';
import { dropExpired, dueItems, enqueue, isPermanentUploadError, markFailed, nextWake, parseQueue, removeItem, type QueuedPhoto } from '../core/uploadQueue';

export const QUEUE_KEY = 'volleylive-photo-queue-v1';

export type ItemStatus = 'uploading' | 'waiting';
export interface QueueView {
  /** Photos still to upload for this match (uploading + waiting). */
  pending: number;
  uploading: boolean;
  /** 0..1 for the photo being uploaded, when the backend reports progress. */
  progress: number | null;
  /** Some photo failed and waits for a retry (offline). */
  waiting: boolean;
  /** Last photo uploaded at (ms), for a short "Uploaded" confirmation. */
  doneAt: number | null;
  /** Last permanent failure for this match (shown until dismissed). */
  error: { at: number; err: unknown } | null;
}

type Listener = () => void;

class PhotoQueue {
  private q: QueuedPhoto[] = [];
  private loaded: Promise<void> | null = null;
  private running = false;
  private current: { id: string; matchId: string; progress: number | null } | null = null;
  private done = new Map<string, number>();
  private errors = new Map<string, { at: number; err: unknown }>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hooked = false;
  /** The signed-in user; null = nobody (or not known yet): nothing is uploaded. */
  private user: string | null = null;
  now = () => Date.now();

  private load() {
    this.loaded ??= AsyncStorage.getItem(QUEUE_KEY)
      .then((raw) => {
        this.q = dropExpired([...parseQueue(raw), ...this.q], this.now());
      })
      .catch(() => {});
    return this.loaded;
  }
  private save() {
    return AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.q)).catch(() => {});
  }
  private emit() {
    for (const l of [...this.listeners]) l();
  }
  private hook() {
    if (this.hooked) return;
    this.hooked = true;
    AppState.addEventListener?.('change', (s) => s === 'active' && this.retryNow());
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', () => this.retryNow());
    // 1.3.4: also when a score write gets through again or the demo "Simulate offline" switch is turned off
    connectivity.subscribe(() => connectivity.isOnline() && this.q.length > 0 && this.retryNow());
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    this.hook();
    void this.load().then(() => {
      this.emit();
      void this.drain();
    });
    return () => this.listeners.delete(l);
  }

  view(matchId: string): QueueView {
    const mine = this.q.filter((x) => x.matchId === matchId);
    const cur = this.current?.matchId === matchId ? this.current : null;
    return {
      pending: mine.length,
      uploading: !!cur,
      progress: cur?.progress ?? null,
      waiting: mine.some((x) => x.tries > 0) && !cur,
      doneAt: this.done.get(matchId) ?? null,
      error: this.errors.get(matchId) ?? null,
    };
  }

  /** Called on every auth change. Drops items queued by another account, then uploads this user's. */
  async setUser(uid: string | null) {
    this.user = uid;
    await this.load();
    if (uid && this.q.some((x) => x.uid !== uid)) {
      this.q = this.q.filter((x) => x.uid === uid);
      await this.save();
    }
    this.emit();
    if (uid) void this.drain();
  }

  /** Sign-out: forget every queued photo and any shown error/confirmation. */
  async clear() {
    await this.load();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.q = [];
    this.user = null;
    this.done.clear();
    this.errors.clear();
    await AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
    this.emit();
  }

  dismissError(matchId: string) {
    this.errors.delete(matchId);
    this.emit();
  }

  async add(matchId: string, uid: string, uri: string) {
    await this.load();
    if (this.user == null) this.user = uid; // first photo before AuthContext reported (tests, fast start)
    const at = this.now();
    this.q = enqueue(this.q, { id: `q_${at.toString(36)}_${Math.random().toString(36).slice(2, 8)}`, matchId, uid, uri, addedAt: at });
    this.errors.delete(matchId);
    await this.save();
    this.emit();
    void this.drain();
  }

  /** Try every waiting photo now (back online / app in front). */
  retryNow() {
    this.q = this.q.map((x) => ({ ...x, nextAt: Math.min(x.nextAt, this.now()) }));
    void this.drain();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wait = nextWake(this.q, this.now());
    if (wait != null) this.timer = setTimeout(() => void this.drain(), Math.max(wait, 250));
  }

  async drain(): Promise<void> {
    await this.load();
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const user = this.user;
        const item = user ? dueItems(this.q, this.now()).find((x) => x.uid === user) : undefined;
        if (!item) break;
        this.current = { id: item.id, matchId: item.matchId, progress: null };
        this.emit();
        try {
          await backend.uploadMatchPhoto(
            item.matchId,
            item.uid,
            item.uri,
            (f) => {
              if (this.current?.id === item.id) {
                this.current.progress = Math.max(0, Math.min(1, f));
                this.emit();
              }
            },
            { idempotencyKey: item.id },
          );
          this.q = removeItem(this.q, item.id);
          this.done.set(item.matchId, this.now());
          connectivity.reportNetworkSuccess();
        } catch (e) {
          if (isNetworkError(e)) connectivity.reportNetworkFailure();
          if (isPermanentUploadError(e)) {
            this.q = removeItem(this.q, item.id);
            this.errors.set(item.matchId, { at: this.now(), err: e });
          } else {
            this.q = markFailed(this.q, item.id, this.now());
            this.current = null;
            await this.save();
            this.emit();
            break; // offline: the rest would fail too; wait for the timer / app focus / online event
          }
        }
        this.current = null;
        await this.save();
        this.emit();
      }
    } finally {
      this.running = false;
      this.current = null;
      this.schedule();
      this.emit();
    }
  }

  /** Tests only. */
  async _reset() {
    if (this.timer) clearTimeout(this.timer);
    this.q = [];
    this.loaded = null;
    this.running = false;
    this.current = null;
    this.user = null;
    this.done.clear();
    this.errors.clear();
    this.listeners.clear();
    await AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
  }
  _items() {
    return [...this.q];
  }
}

export const photoQueue = new PhotoQueue();
