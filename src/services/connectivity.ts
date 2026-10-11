/**
 * 1.3.4 (QA D133-1): is the app online? Drives the "Offline · N pending" / "Syncing…" header.
 *
 * - Web: the browser's navigator.onLine plus its online/offline events (DevTools "Offline" works).
 * - Phones: there is no network-info module in this build (no installs), so the state comes from the
 *   writes themselves: a write that fails with a network error marks the app offline, the next
 *   successful write marks it online again (reportNetworkFailure / reportNetworkSuccess).
 * - Demo mode only: a "Simulate offline" switch (Profile) for testing; the demo backend then refuses
 *   writes like a dropped connection so the pending queue and its retry can be seen. 1.3.5: the switch
 *   survives a reload (the demo backend stores it with its other demo data and restores it).
 * - 1.3.5 (QA E134-1), web: navigator.onLine can say "online" while requests fail (a dropped
 *   connection the browser hasn't noticed, some DevTools setups). The demo backend saves locally,
 *   so its saves "succeeded" and the header said "✓ Synced" while offline. `reachable()` asks the
 *   app's own web server (same origin, HEAD, no cache, 3 s) so the demo can tell for real.
 */
import { Platform } from 'react-native';
import { useEffect, useState } from 'react';

type Listener = () => void;

const navOnline = () => {
  if (Platform.OS !== 'web') return true;
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
};

class Connectivity {
  private failed = false;
  private simulated = false;
  private listeners = new Set<Listener>();
  private simListeners = new Set<(on: boolean) => void>();
  private hooked = false;

  private hook() {
    if (this.hooked) return;
    this.hooked = true;
    const w = (globalThis as { addEventListener?: (t: string, f: () => void) => void }).addEventListener;
    if (Platform.OS === 'web' && typeof w === 'function') {
      w.call(globalThis, 'online', () => {
        this.failed = false; // the browser says the network is back: let the waiting writes retry
        this.emit();
      });
      w.call(globalThis, 'offline', () => this.emit());
    }
  }
  private emit() {
    for (const l of [...this.listeners]) l();
  }
  /** False when the browser says offline, a write just failed for lack of network, or offline is simulated (demo). */
  isOnline(): boolean {
    return navOnline() && !this.failed && !this.simulated;
  }
  /** Demo "Simulate offline" only (the caller checks DEMO_MODE). */
  isSimulatedOffline() {
    return this.simulated;
  }
  setSimulatedOffline(on: boolean) {
    if (this.simulated === on) return;
    this.simulated = on;
    if (!on) this.failed = false; // those failures were the simulation; the retry will tell
    this.simListeners.forEach((l) => l(on));
    this.emit();
  }
  /** The demo backend stores the switch (demo builds only) so it survives a reload. */
  onSimulatedChange(l: (on: boolean) => void) {
    this.simListeners.add(l);
    return () => void this.simListeners.delete(l);
  }
  /**
   * Web only (always true elsewhere): can the app's own web server be reached right now? Same origin,
   * so nothing outside the app is contacted. Any HTTP answer counts; a refused/aborted request or no
   * answer within 3 s does not.
   */
  async reachable(): Promise<boolean> {
    if (Platform.OS !== 'web') return true;
    if (!navOnline()) return false;
    const g = globalThis as { fetch?: typeof fetch; location?: { origin?: string } };
    const origin = g.location?.origin;
    if (typeof g.fetch !== 'function' || !origin || !/^https?:/.test(origin)) return true;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), 3000);
    try {
      await g.fetch(`${origin}/favicon.ico?vl-reach=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctl?.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  reportNetworkFailure() {
    if (this.failed) return;
    this.failed = true;
    this.emit();
  }
  reportNetworkSuccess() {
    if (!this.failed) return;
    this.failed = false;
    this.emit();
  }
  subscribe(l: Listener) {
    this.hook();
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
}

export const connectivity = new Connectivity();

/** A write failed because there is no connection (not a refusal by the backend). */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /network|offline|failed to fetch|timeout|unavailable|ECONN|ENOTFOUND/i.test(msg);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => connectivity.isOnline());
  useEffect(() => {
    const sync = () => setOnline(connectivity.isOnline());
    sync();
    return connectivity.subscribe(sync);
  }, []);
  return online;
}

/** "Offline · 3 pending" / "Syncing…" / "✓ Synced" – the header label (score screen and viewer). */
export type SyncView = { kind: 'offline' | 'syncing' | 'synced' | 'error'; pending: number };
export function syncView(o: { online: boolean; saving: boolean; failed: boolean; error: boolean; pending: number }): SyncView {
  if (o.error) return { kind: 'error', pending: o.pending };
  if (!o.online || o.failed) return { kind: 'offline', pending: o.pending };
  if (o.saving || o.pending > 0) return { kind: 'syncing', pending: o.pending };
  return { kind: 'synced', pending: 0 };
}
