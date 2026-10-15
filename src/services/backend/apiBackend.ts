import { checkAskQuestion, type AskAnswer } from '../../core/ask';
import type { RepairFix } from '../../core/verdictRepair';
import { assertSupportImage, checkSupportStatus, checkSupportTicket, type NewSupportTicket, type SupportStatus, type SupportTicket } from '../../core/support';
import { checkFeedback } from '../../core/reviewPrompt';
import { checkDailyItem, type DailyItem } from '../../core/dailyItems';
/**
 * Backend that talks to the VolleyLive API server (server/): REST for reads and
 * writes, one WebSocket (/live) for real-time updates. Firebase is only used for
 * phone OTP sign-in (its ID token is sent as a Bearer token); push sending happens
 * on the server.
 *
 * Watchers fetch once, then subscribe to a topic. `match:<id>` messages carry the
 * whole match (live scoreboard); other topics only say "something changed" and the
 * watcher refetches (their content depends on who is asking).
 *
 * Local testing without Firebase: EXPO_PUBLIC_API_DEV_AUTH=1 signs in with
 * `dev:<phone>` tokens and the demo OTP (the server must run with AUTH_MODE=dev).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { Challenge, ChallengeStatus, Court, Match, MatchPhoto, Team, Tournament, UserProfile } from '../../core/types';
import type { AbandonAnswer, ResolveAction } from '../../core/abandon';
import { API_DEV_AUTH, API_OTP_AUTH, API_URL, DEMO_OTP } from '../config';
import { IDEMPOTENCY_KEY_RE, inviteState, PHOTO_WRONG_ACCOUNT, type InviteState } from './types';
import type { AuthUser, Backend, FeedbackItem, MatchProgress, NewChallenge, NewCourt, NewMatch, NewTeam, NewTournament, PhoneVerifier, RankingsResult, ReviewDecision, Unsubscribe, UploadOptions, UploadProgress, WalletResult } from './types';
import type { TermsAcceptance } from '../../core/terms';
import { CodedError } from '../../core/codedError';
import { readPhoto } from '../photoFile';

const DEV_AUTH_KEY = 'volleylive-api-dev-auth-v1';
const OTP_SESSION_KEY = 'volleylive-api-otp-session-v1';

export class ApiError extends Error {
  /** Server error code (JSON `error`), e.g. "text_too_long" or "invalid_phone"; translated by i18n/format. */
  readonly code?: string;
  readonly field?: string;
  readonly min?: number;
  readonly max?: number;
  /** 429 rate_limited (QA C130-2): seconds until the server accepts the next request. */
  readonly retryAfter?: number;
  /** otp_invalid (launch prep): wrong codes left before the code is burnt. */
  readonly attemptsLeft?: number;
  constructor(readonly status: number, message: string, body?: { error?: string; field?: string; min?: number; max?: number; retryAfter?: number; attemptsLeft?: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = body?.error;
    this.field = body?.field;
    this.min = body?.min;
    this.max = body?.max;
    this.retryAfter = typeof body?.retryAfter === 'number' ? body.retryAfter : undefined;
    this.attemptsLeft = typeof body?.attemptsLeft === 'number' ? body.attemptsLeft : undefined;
  }
}

/** Strip `undefined` so JSON bodies match what the server validates. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null)) as T;
}

const chunk = <T>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How the app gets the Bearer token. */
export interface TokenSource {
  onAuthChanged(cb: (u: AuthUser | null) => void): Unsubscribe;
  sendOtp(phone: string, verifier: PhoneVerifier | null): Promise<{ confirm(code: string): Promise<void> }>;
  signOut(): Promise<void>;
  token(forceRefresh?: boolean): Promise<string | null>;
}

/** Firebase phone auth (production). Loaded lazily so dev-auth builds never touch Firebase. */
class FirebaseTokenSource implements TokenSource {
  private get auth() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('../firebase') as typeof import('../firebase')).getFirebase().auth;
  }
  onAuthChanged(cb: (u: AuthUser | null) => void) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { onAuthStateChanged } = require('firebase/auth') as typeof import('firebase/auth');
    return onAuthStateChanged(this.auth, (u) => cb(u ? { uid: u.uid, phoneNumber: u.phoneNumber } : null));
  }
  async sendOtp(phone: string, verifier: PhoneVerifier | null) {
    if (!verifier) throw new Error('reCAPTCHA verifier not ready');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { signInWithPhoneNumber } = require('firebase/auth') as typeof import('firebase/auth');
    const c = await signInWithPhoneNumber(this.auth, phone, verifier as never);
    return { confirm: async (code: string) => void (await c.confirm(code)) };
  }
  async signOut() {
    await this.auth.signOut();
  }
  async token(force = false) {
    return (await this.auth.currentUser?.getIdToken(force)) ?? null;
  }
}

/** Local testing only: the server must run with AUTH_MODE=dev. OTP is the demo code. */
export class DevTokenSource implements TokenSource {
  private user: (AuthUser & { token: string }) | null = null;
  private loaded = false;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(private resolveUid: (token: string) => Promise<string>) {}

  private emit() {
    const u = this.user ? { uid: this.user.uid, phoneNumber: this.user.phoneNumber } : null;
    this.listeners.forEach((l) => l(u));
  }
  onAuthChanged(cb: (u: AuthUser | null) => void) {
    this.listeners.add(cb);
    if (this.loaded) cb(this.user ? { uid: this.user.uid, phoneNumber: this.user.phoneNumber } : null);
    else
      AsyncStorage.getItem(DEV_AUTH_KEY)
        .then((raw) => {
          if (!this.loaded) this.user = raw ? JSON.parse(raw) : null;
          this.loaded = true;
          this.emit();
        })
        .catch(() => {
          this.loaded = true;
          this.emit();
        });
    return () => void this.listeners.delete(cb);
  }
  async sendOtp(phone: string) {
    return {
      confirm: async (code: string) => {
        if (code !== DEMO_OTP) throw new Error('auth/invalid-verification-code');
        const token = `dev:${phone}`;
        const uid = await this.resolveUid(token);
        this.user = { uid, phoneNumber: phone, token };
        this.loaded = true;
        await AsyncStorage.setItem(DEV_AUTH_KEY, JSON.stringify(this.user));
        this.emit();
      },
    };
  }
  async signOut() {
    this.user = null;
    await AsyncStorage.removeItem(DEV_AUTH_KEY);
    this.emit();
  }
  async token() {
    return this.user?.token ?? null;
  }
}

/**
 * Launch prep (production sign-in): the API server sends the SMS itself (AUTH_MODE=otp, OTP_PROVIDER=msg91)
 * and answers a correct code with a revocable session token (`vls1.…`, 30 days). Only that token and the
 * uid/phone are kept on the phone; sign-out revokes it on the server. Error codes (otp_invalid with
 * attemptsLeft, otp_resend_wait, otp_too_many, otp_expired, …) are translated by i18n/format.
 */
type OtpSession = AuthUser & { token: string; expiresAt: number };
export class ServerOtpTokenSource implements TokenSource {
  private user: OtpSession | null = null;
  private loaded = false;
  private listeners = new Set<(u: AuthUser | null) => void>();
  constructor(private base: string, private now: () => number = Date.now) {}

  private snapshot(): AuthUser | null {
    return this.user ? { uid: this.user.uid, phoneNumber: this.user.phoneNumber } : null;
  }
  private emit() {
    const u = this.snapshot();
    this.listeners.forEach((l) => l(u));
  }
  private async post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${this.base}/auth${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: { message?: string } | undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) throw new ApiError(res.status, data?.message || `Request failed (${res.status})`, data as never);
    return data as T;
  }
  onAuthChanged(cb: (u: AuthUser | null) => void) {
    this.listeners.add(cb);
    if (this.loaded) cb(this.snapshot());
    else
      AsyncStorage.getItem(OTP_SESSION_KEY)
        .then((raw) => {
          if (!this.loaded) {
            const saved = raw ? (JSON.parse(raw) as OtpSession) : null;
            this.user = saved && saved.expiresAt > this.now() ? saved : null;
          }
          this.loaded = true;
          this.emit();
        })
        .catch(() => {
          this.loaded = true;
          this.emit();
        });
    return () => void this.listeners.delete(cb);
  }
  async sendOtp(phone: string) {
    await this.post('/otp/request', { phone });
    return {
      confirm: async (code: string) => {
        const s = await this.post<{ token: string; uid: string; expiresAt: number }>('/otp/verify', { phone, code });
        this.user = { uid: s.uid, phoneNumber: phone, token: s.token, expiresAt: s.expiresAt };
        this.loaded = true;
        await AsyncStorage.setItem(OTP_SESSION_KEY, JSON.stringify(this.user));
        this.emit();
      },
    };
  }
  async signOut() {
    const token = this.user?.token;
    this.user = null;
    await AsyncStorage.removeItem(OTP_SESSION_KEY);
    this.emit();
    if (token) await this.post('/logout', {}, token).catch(() => {}); // best effort; it expires anyway
  }
  async token() {
    if (this.user && this.user.expiresAt <= this.now()) {
      this.user = null;
      await AsyncStorage.removeItem(OTP_SESSION_KEY);
      this.emit();
    }
    return this.user?.token ?? null;
  }
}

type ProgressQueue = { pending: MatchProgress | null; running: boolean; waiters: { resolve: () => void; reject: (e: unknown) => void }[] };

type LiveMsg = { type: 'ready' | 'doc' | 'invalidate' | 'deleted'; topic?: string; data?: unknown };
type TopicListener = { onMsg: (m: LiveMsg) => void; onReconnect: () => void };

/** One shared WebSocket with topic ref-counting, auth and automatic reconnect. */
class LiveSocket {
  private ws: WebSocket | null = null;
  private ready = false;
  private topics = new Map<string, Set<TopicListener>>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasConnected = false;
  constructor(private url: string, private token: () => Promise<string | null>) {}

  subscribe(topic: string, l: TopicListener): Unsubscribe {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
      if (this.ready) this.send({ type: 'sub', topic });
    }
    set.add(l);
    this.ensure();
    return () => {
      const s = this.topics.get(topic);
      if (!s) return;
      s.delete(l);
      if (!s.size) {
        this.topics.delete(topic);
        if (this.ready) this.send({ type: 'unsub', topic });
      }
    };
  }
  /** Close (e.g. on sign-out); reopens on the next subscription. */
  reset() {
    this.ready = false;
    this.ws?.close();
    this.ws = null;
  }
  private send(m: object) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  private ensure() {
    if (this.ws || this.timer || !this.topics.size) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.schedule();
    }
    this.ws = ws;
    ws.onopen = async () => {
      const t = await this.token().catch(() => null);
      if (!t || this.ws !== ws) return ws.close();
      ws.send(JSON.stringify({ type: 'auth', token: t }));
    };
    ws.onmessage = (ev) => {
      let m: LiveMsg;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'ready') {
        this.ready = true;
        this.retry = 0;
        for (const topic of this.topics.keys()) this.send({ type: 'sub', topic });
        // Anything may have changed while we were offline: refetch everything.
        if (this.wasConnected) this.topics.forEach((s) => s.forEach((l) => l.onReconnect()));
        this.wasConnected = true;
        return;
      }
      if (m.topic) this.topics.get(m.topic)?.forEach((l) => l.onMsg(m));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      this.schedule();
    };
    ws.onerror = () => ws.close();
  }
  private schedule() {
    if (this.timer || !this.topics.size) return;
    const delay = Math.min(30000, 500 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ensure();
    }, delay);
  }
}

export class ApiBackend implements Backend {
  readonly mode = 'api' as const;
  private base: string;
  private auth: TokenSource;
  private live: LiveSocket;
  /** Latest-wins queue per match so rapid taps are saved in order and retried when offline. */
  private progressQueue = new Map<string, ProgressQueue>();

  constructor(opts: { baseUrl?: string; devAuth?: boolean; otpAuth?: boolean; tokenSource?: TokenSource } = {}) {
    this.base = (opts.baseUrl ?? API_URL).replace(/\/$/, '');
    this.auth =
      opts.tokenSource ??
      ((opts.devAuth ?? API_DEV_AUTH)
        ? new DevTokenSource(async (token) => (await this.request<{ uid: string }>('GET', '/me', undefined, token)).uid)
        : (opts.otpAuth ?? API_OTP_AUTH)
          ? new ServerOtpTokenSource(this.base)
          : new FirebaseTokenSource());
    this.live = new LiveSocket(this.base.replace(/^http/, 'ws') + '/live', () => this.auth.token());
  }

  // ---------- server clock (1.3.8, V137-4: the review cooldown uses it) ----------
  private clockOffset: number | null = null;
  private noteServerTime(res: Response) {
    const d = res.headers?.get?.('date');
    const at = d ? Date.parse(d) : NaN;
    if (Number.isFinite(at)) this.clockOffset = at - Date.now();
  }
  serverNow(): number | null {
    return this.clockOffset == null ? null : Date.now() + this.clockOffset;
  }

  // ---------- HTTP ----------
  private async request<T>(method: string, path: string, body?: unknown, tokenOverride?: string, raw?: { blob: Blob; type: string; headers?: Record<string, string> }): Promise<T> {
    const send = async (force: boolean) => {
      const token = tokenOverride ?? (await this.auth.token(force));
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (raw) Object.assign(headers, raw.headers ?? {}, { 'Content-Type': raw.type });
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      return fetch(`${this.base}/api${path}`, { method, headers, body: raw ? raw.blob : body !== undefined ? JSON.stringify(clean(body)) : undefined });
    };
    let res = await send(false);
    if (res.status === 401 && !tokenOverride) res = await send(true); // expired Firebase ID token
    this.noteServerTime(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (data && data.message) || `Request failed (${res.status})`, data);
    return data as T;
  }
  private get = <T>(p: string) => this.request<T>('GET', p);
  private getOrNull = async <T>(p: string): Promise<T | null> => {
    try {
      return await this.get<T>(p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  };

  /** Fetch now, then refetch (debounced) whenever the topic changes or the socket reconnects. */
  private watch<T>(topic: string, load: () => Promise<T>, cb: (v: T) => void, onDoc?: (m: LiveMsg) => T | undefined): Unsubscribe {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      load()
        .then((v) => alive && mine === seq && cb(v))
        .catch((e) => console.warn(`[api] ${topic}:`, e?.message ?? e));
    };
    const refetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 150);
    };
    const unsub = this.live.subscribe(topic, {
      onMsg: (m) => {
        const v = onDoc?.(m);
        if (v !== undefined) {
          seq++; // a pushed document beats any older fetch still in flight
          if (alive) cb(v);
        } else refetch();
      },
      onReconnect: refetch,
    });
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }

  // ---------- auth ----------
  /** The signed-in uid as last reported by the token source (photo uploads check it). */
  private currentUid: string | null = null;
  onAuthChanged(cb: (u: AuthUser | null) => void) {
    return this.auth.onAuthChanged((u) => {
      this.currentUid = u?.uid ?? null;
      cb(u);
    });
  }
  sendOtp(phone: string, verifier: PhoneVerifier | null) {
    return this.auth.sendOtp(phone, verifier);
  }
  async signOut() {
    await this.auth.signOut();
    this.currentUid = null;
    this.live.reset();
  }

  // ---------- profiles ----------
  watchProfile(uid: string, cb: (p: UserProfile | null) => void) {
    return this.watch(`profile:${uid}`, () => this.getOrNull<UserProfile>(`/users/${encodeURIComponent(uid)}`), cb);
  }
  async saveProfile(p: UserProfile) {
    await this.request('PUT', `/users/${encodeURIComponent(p.id)}`, p);
  }
  async getProfiles(uids: string[]) {
    const ids = [...new Set(uids)].filter(Boolean);
    const out: UserProfile[] = [];
    for (const part of chunk(ids, 50)) out.push(...(await this.get<UserProfile[]>(`/users?ids=${part.map(encodeURIComponent).join(',')}`)));
    return out;
  }
  findUserByPhone(phone: string) {
    return this.getOrNull<UserProfile>(`/users/by-phone/${encodeURIComponent(phone)}`);
  }
  /** Reads + checks the photo on the client (services/photoFile.ts), then POSTs it with its sniffed type. */
  private async upload<T>(path: string, localUri: string, headers?: Record<string, string>) {
    const { blob, type } = await readPhoto(localUri);
    return this.request<T>('POST', path, undefined, undefined, { blob, type, headers });
  }
  async uploadAvatar(uid: string, localUri: string) {
    return (await this.upload<{ url: string }>(`/users/${encodeURIComponent(uid)}/avatar`, localUri)).url;
  }
  async savePushToken(_uid: string, token: string) {
    await this.request('PUT', '/me/push-tokens', { token, platform: Platform.OS });
  }

  // ---------- teams ----------
  async createTeam(t: NewTeam) {
    return (await this.request<{ id: string }>('POST', '/teams', t)).id;
  }
  async updateTeam(id: string, patch: Partial<Team>) {
    const { id: _id, nameLower: _n, createdAt: _c, ...p } = patch;
    await this.request('PATCH', `/teams/${encodeURIComponent(id)}`, p);
  }
  watchTeam(id: string, cb: (t: Team | null) => void) {
    return this.watch(`team:${id}`, () => this.getOrNull<Team>(`/teams/${encodeURIComponent(id)}`), cb, (m) => (m.type === 'deleted' ? null : undefined));
  }
  watchMyTeams(uid: string, cb: (t: Team[]) => void) {
    return this.watch('teams', () => this.get<Team[]>(`/teams?member=${encodeURIComponent(uid)}`), cb);
  }
  watchTeamInvites(phone: string, cb: (t: Team[]) => void, onState?: (s: InviteState) => void) {
    // The server answers 400 invalid_phone for a non-Indian number (an account from before build 216):
    // report that state instead of a silently empty list (fix-retest N4).
    onState?.(inviteState(phone));
    if (inviteState(phone) !== 'ok') {
      cb([]);
      return () => {};
    }
    return this.watch('teams', () => this.get<Team[]>(`/teams?invitedPhone=${encodeURIComponent(phone)}`), cb);
  }
  async acceptTeamInvite(teamId: string) {
    await this.request('POST', `/teams/${encodeURIComponent(teamId)}/accept`);
  }
  async declineTeamInvite(teamId: string) {
    await this.request('POST', `/teams/${encodeURIComponent(teamId)}/decline`);
  }
  searchTeams(prefix: string) {
    return this.get<Team[]>(`/teams?q=${encodeURIComponent(prefix.trim())}`);
  }

  // ---------- matches ----------
  async createMatch(m: NewMatch) {
    return (await this.request<{ id: string }>('POST', '/matches', m)).id;
  }
  watchMatch(id: string, cb: (m: Match | null) => void) {
    let last: Match | null = null;
    const emit = (m: Match | null) => {
      // pushed documents never contain the stream ingest URL; keep the one the scorer fetched
      if (m && last?.stream?.ingestUrl && m.stream && !m.stream.ingestUrl) m = { ...m, stream: { ...m.stream, ingestUrl: last.stream.ingestUrl } };
      last = m;
      cb(m);
    };
    return this.watch(`match:${id}`, () => this.getOrNull<Match>(`/matches/${encodeURIComponent(id)}`), emit, (msg) =>
      msg.type === 'doc' ? (msg.data as Match) : msg.type === 'deleted' ? null : undefined,
    );
  }
  /**
   * Saves are queued per match, latest state wins: rapid taps are sent in order, a network failure
   * retries the newest state with backoff, and every call resolves once its state (or a newer one)
   * is on the server. The server derives summary and status from the events, so we send the log.
   */
  async setPlayerOfMatch(matchId: string, playerId: string) {
    await this.request('PUT', `/matches/${encodeURIComponent(matchId)}/player-of-match`, { playerId });
  }
  saveMatchProgress(id: string, p: MatchProgress): Promise<void> {
    let q = this.progressQueue.get(id);
    if (!q) this.progressQueue.set(id, (q = { pending: null, running: false, waiters: [] }));
    const queue = q;
    queue.pending = p;
    const done = new Promise<void>((resolve, reject) => queue.waiters.push({ resolve, reject }));
    if (!queue.running) void this.drainProgress(id, queue);
    return done;
  }
  private async drainProgress(id: string, q: ProgressQueue) {
    q.running = true;
    let attempt = 0;
    while (q.pending) {
      const next: MatchProgress = q.pending;
      try {
        await this.request('PUT', `/matches/${encodeURIComponent(id)}/progress`, { events: next.events, status: next.status, startedAt: next.startedAt, finishedAt: next.finishedAt });
        attempt = 0;
        if (q.pending === next) {
          q.pending = null;
          q.waiters.splice(0).forEach((w) => w.resolve());
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 429) {
          // QA C130-2: rate limited -> wait as the server asks and send the newest state (no lost rallies)
          await sleep(Math.min(60_000, Math.max(1, e.retryAfter ?? 1) * 1000));
        } else if (e instanceof ApiError) {
          if (q.pending !== next) continue; // a newer state is queued: try that one
          q.pending = null;
          q.waiters.splice(0).forEach((w) => w.reject(e)); // rejected by the rules: tell the scorer
        } else await sleep(Math.min(15000, 1000 * 2 ** attempt++)); // offline: retry the newest state
      }
    }
    q.running = false;
  }
  async updateMatch(id: string, patch: Partial<Match>) {
    const { id: _id, createdAt: _c, updatedAt: _u, summary: _s, maxEvents: _mx, wasWon: _w, abandon: _a, abandonRequest: _ar, resolution: _r, scorerReassign: _sr, ...p } = patch as Partial<Match> & { rotation?: unknown };
    delete (p as { rotation?: unknown }).rotation;
    await this.request('PATCH', `/matches/${encodeURIComponent(id)}`, p);
  }
  watchLiveMatches(cb: (m: Match[]) => void) {
    return this.watch('matches', () => this.get<Match[]>('/matches?status=live,scheduled'), cb);
  }
  watchMyMatches(uid: string, cb: (m: Match[]) => void) {
    return this.watch('matches', () => this.get<Match[]>(`/matches?participant=${encodeURIComponent(uid)}`), cb);
  }
  watchTournamentMatches(tid: string, cb: (m: Match[]) => void) {
    return this.watch('matches', () => this.get<Match[]>(`/matches?tournament=${encodeURIComponent(tid)}`), cb);
  }
  listPublicMatches() {
    return this.get<Match[]>('/matches?public=1');
  }

  // ---------- photos ----------
  watchPhotos(matchId: string, cb: (p: MatchPhoto[]) => void) {
    return this.watch(`photos:${matchId}`, () => this.get<MatchPhoto[]>(`/matches/${encodeURIComponent(matchId)}/photos`), cb);
  }
  async uploadMatchPhoto(matchId: string, uid: string, localUri: string, onProgress?: UploadProgress, opts?: UploadOptions) {
    // Retest 1.1.0 NB-P1: only photos queued by the signed-in user are uploaded with this token.
    if (!this.currentUid) throw new Error('Not signed in yet'); // retried once auth is known
    if (uid !== this.currentUid) throw new CodedError(PHOTO_WRONG_ACCOUNT, 'This photo was added by another account');
    const key = opts?.idempotencyKey && IDEMPOTENCY_KEY_RE.test(opts.idempotencyKey) ? opts.idempotencyKey : undefined;
    // fetch() reports no upload progress: the chip shows "uploading" until this resolves.
    await this.upload(`/matches/${encodeURIComponent(matchId)}/photos`, localUri, key ? { 'Idempotency-Key': key } : undefined);
    onProgress?.(1);
  }
  async deleteMatchPhoto(photo: MatchPhoto) {
    await this.request('DELETE', `/matches/${encodeURIComponent(photo.matchId)}/photos/${encodeURIComponent(photo.id)}`);
  }
  listMemories(uid: string) {
    return this.get<MatchPhoto[]>(`/users/${encodeURIComponent(uid)}/photos`);
  }

  // ---------- rankings ----------
  getRankings(_uid: string) {
    return this.get<RankingsResult>('/rankings?limit=100');
  }
  getWallet(_uid: string) {
    return this.get<WalletResult>('/me/wallet');
  }

  // ---------- T&C, confirmation, admin review (1.3.0) ----------
  async getTerms(_uid: string) {
    const me = await this.get<{ terms: TermsAcceptance | null }>('/me');
    return me.terms ?? null;
  }
  async acceptTerms(_uid: string, version: string) {
    await this.request('POST', '/me/terms/accept', { version });
  }
  async isAdmin(_uid: string) {
    const me = await this.get<{ isAdmin?: boolean }>('/me');
    return me.isAdmin === true;
  }
  async confirmResult(matchId: string) {
    await this.request('POST', `/matches/${encodeURIComponent(matchId)}/confirm`);
  }
  async rejectResult(matchId: string, reason: string) {
    await this.request('POST', `/matches/${encodeURIComponent(matchId)}/reject`, { reason });
  }
  async reviewMatch(matchId: string, decision: ReviewDecision) {
    await this.request('POST', `/admin/matches/${encodeURIComponent(matchId)}/review`, { decision });
  }
  listFlagged() {
    return this.get<Match[]>('/admin/matches/flagged');
  }
  // 1.4.5 (QA V144-1/2/3): abandon / consent request / admin resolution (server/src/domain/matches.ts, core/abandon.ts)
  async abandonMatch(matchId: string) {
    const r = await this.request<{ result: 'abandoned' | 'requested' }>('POST', `/matches/${encodeURIComponent(matchId)}/abandon`, {});
    return r?.result === 'requested' ? ('requested' as const) : ('abandoned' as const);
  }
  async answerAbandonRequest(matchId: string, action: AbandonAnswer) {
    await this.request('POST', `/matches/${encodeURIComponent(matchId)}/abandon-request`, { action });
  }
  async resolveMatch(matchId: string, action: ResolveAction) {
    await this.request('POST', `/admin/matches/${encodeURIComponent(matchId)}/resolve`, { action });
  }
  async reportAbandon(matchId: string) {
    await this.request('POST', `/matches/${encodeURIComponent(matchId)}/abandon-report`, {});
  }
  async handoffAdmins(matchId: string) {
    return this.request<{ id: string; name: string }[]>('GET', `/matches/${encodeURIComponent(matchId)}/handoff-admins`);
  }
  async reassignScorer(matchId: string, scorerId: string) {
    await this.request('POST', `/admin/matches/${encodeURIComponent(matchId)}/scorer`, { scorerId });
  }
  async repairVerdict(matchId: string, fix: RepairFix) {
    await this.request('POST', `/admin/matches/${encodeURIComponent(matchId)}/repair-verdict`, fix);
  }
  // 1.3.7 feedback + fact of the day
  async sendFeedback(f: { stars: number; text: string; appVersion?: string }) {
    const c = checkFeedback(f);
    await this.request('POST', '/feedback', c);
  }
  // 1.4.19 support tickets: JSON create, then the screenshot as a raw image body
  /** 1.4.20: the server's RAG (provider chosen there by ASK_PROVIDER). */
  askVolleyLive(question: string, lang: 'en' | 'hi') {
    const q = checkAskQuestion({ question, lang });
    return this.request<AskAnswer>('POST', '/ask', q);
  }
  async createSupportTicket(t: NewSupportTicket) {
    const c = checkSupportTicket(t);
    if (t.screenshot) assertSupportImage(t.screenshot.type, t.screenshot.size);
    const { id } = await this.request<{ id: string }>('POST', '/support/tickets', c);
    if (t.screenshot) await this.upload(`/support/tickets/${encodeURIComponent(id)}/screenshot`, t.screenshot.uri);
    return id;
  }
  listMySupportTickets() {
    return this.get<SupportTicket[]>('/support/tickets');
  }
  listSupportTickets() {
    return this.get<SupportTicket[]>('/admin/support/tickets');
  }
  async setSupportTicketStatus(id: string, status: SupportStatus) {
    await this.request('PATCH', `/admin/support/tickets/${encodeURIComponent(id)}`, { status: checkSupportStatus(status) });
  }
  listFeedback() {
    return this.get<FeedbackItem[]>('/admin/feedback');
  }
  listDailyItems(opts?: { all?: boolean }) {
    return this.get<DailyItem[]>(opts?.all ? '/admin/daily-items' : '/daily-items');
  }
  async saveDailyItem(item: Partial<DailyItem>) {
    const body = checkDailyItem(item);
    const r = item.id
      ? await this.request<{ id: string }>('PATCH', `/admin/daily-items/${encodeURIComponent(item.id)}`, body)
      : await this.request<{ id: string }>('POST', '/admin/daily-items', body);
    return (r as { id?: string } | undefined)?.id ?? item.id ?? '';
  }
  async deleteDailyItem(id: string) {
    await this.request('DELETE', `/admin/daily-items/${encodeURIComponent(id)}`);
  }
  async lookupPincode(pin: string) {
    try {
      return await this.get<import('../../core/registration').PincodeInfo>(`/pincode/${encodeURIComponent(pin)}`);
    } catch {
      return { status: 'unknown' as const }; // offline / server error: the format check decides
    }
  }


  // ---------- challenges ----------
  async createChallenge(c: NewChallenge) {
    return (await this.request<{ id: string }>('POST', '/challenges', c)).id;
  }
  watchChallenges(teamIds: string[], cb: (c: Challenge[]) => void) {
    if (!teamIds.length) {
      cb([]);
      return () => {};
    }
    return this.watch('challenges', () => this.get<Challenge[]>(`/challenges?teams=${teamIds.map(encodeURIComponent).join(',')}`), cb);
  }
  async respondToChallenge(c: Challenge, status: ChallengeStatus, matchId?: string) {
    await this.request('PATCH', `/challenges/${encodeURIComponent(c.id)}`, { status, matchId: matchId ?? null });
  }

  // ---------- tournaments ----------
  async createTournament(t: NewTournament) {
    return (await this.request<{ id: string }>('POST', '/tournaments', t)).id;
  }
  async updateTournament(id: string, patch: Partial<Tournament>) {
    const { id: _id, createdAt: _c, ...p } = patch;
    await this.request('PATCH', `/tournaments/${encodeURIComponent(id)}`, p);
  }
  async deleteTournament(id: string) {
    await this.request('DELETE', `/tournaments/${encodeURIComponent(id)}`);
  }
  watchTournament(id: string, cb: (t: Tournament | null) => void) {
    return this.watch(`tournament:${id}`, () => this.getOrNull<Tournament>(`/tournaments/${encodeURIComponent(id)}`), cb, (m) => (m.type === 'deleted' ? null : undefined));
  }
  watchTournaments(cb: (t: Tournament[]) => void) {
    return this.watch('tournaments', () => this.get<Tournament[]>('/tournaments'), cb);
  }

  // ---------- courts ----------
  async addCourt(c: NewCourt) {
    return (await this.request<{ id: string }>('POST', '/courts', c)).id;
  }
  listCourts() {
    return this.get<Court[]>('/courts');
  }
}
