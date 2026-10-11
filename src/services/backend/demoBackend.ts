/**
 * Demo backend: an in-memory database with sample data, persisted to
 * AsyncStorage. Lets you try every screen without a Firebase project.
 * OTP code is always 123456.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_ADMIN_UIDS, DEMO_OTP } from '../config';
import { addPoint, computeState, summarize, type Side } from '../../core/scoring';
import { assertRoster, canonicalParticipants, challengeProblem, isAbandonOnly, PARTICIPANTS_MESSAGE, participantsMatchRoster, ROSTER_MESSAGES, teamCanPlay, TEAM_TOO_SMALL_MESSAGE, TOURNAMENT_ORGANIZER_MESSAGE, tournamentTeamsProblem } from '../../core/roster';
import type { Challenge, Court, Match, MatchPhoto, Team, Tournament, UserProfile } from '../../core/types';
import { DemoDB, demoPhotoUrl, makeSeed, refreshSeedColours, SEED_PHOTO_SCENES } from './demoSeed';
import i18next from 'i18next';
import type { AuthUser, Backend, MatchProgress, NewChallenge, NewCourt, NewMatch, NewTeam, NewTournament, RankingsResult, ReviewDecision, Unsubscribe, UploadOptions, UploadProgress, WalletResult } from './types';
import { POTM_MESSAGES, potmProblem } from '../../core/potm';
import { MIN_RANKED_MATCHES, rankPlayers, rowFor } from '../../core/ranking';
import { CONFIRM_MESSAGES, confirmProblem, countMatches, countedMatchIdsFor, countedTotals, isCompleted, needsReview, playerWallet, verificationStatus } from '../../core/antifraud';
import { guardCreate, guardProgress, guardUpdate, stampTimes } from '../../core/matchGuards';
import { TERMS_NOT_ACCEPTED, TERMS_NOT_ACCEPTED_MESSAGE, TERMS_VERSION, TERMS_VERSION_MISMATCH, termsAccepted, type TermsAcceptance } from '../../core/terms';
import { checkText } from '../../core/validate';
import { canAddMatchPhoto } from '../../core/photos';
import { CodedError, PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE } from '../../core/codedError';
import { INVALID_PHONE_CODE, isValidE164 } from '../../core/phone';

/** Mirrors the API (400 invalid_phone) and firestore.rules: +91 followed by 10 digits starting 6-9. */
function assertPhone(phone: string) {
  if (!isValidE164(phone)) throw new Error(INVALID_PHONE_CODE);
}

// v2: every match player is a registered user (no typed names / name-only tournament teams).
import { checkChallengeFields, checkCourtFields, checkMatchFields, checkOrder, checkProfileFields, checkTeamFields, checkTournamentFields } from '../../core/validate';
import { IDEMPOTENCY_KEY_RE, inviteState, PHOTO_WRONG_ACCOUNT, type InviteState } from './types';
import { Platform } from 'react-native';
import { readPhoto } from '../photoFile';

const KEY = 'volleylive-demo-db-v2';
const AUTH_KEY = 'volleylive-demo-auth-v1';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

type Listener = () => void;

/** Seed photos are drawn with their caption in the app language (QA B121-4); uploads are unchanged. */
function localizedPhoto(p: MatchPhoto): MatchPhoto {
  const scene = SEED_PHOTO_SCENES[p.id];
  return scene == null ? p : { ...p, url: demoPhotoUrl(scene, i18next.language ?? 'en') };
}

/** Web demo: the browser says it is offline (native demo has no network check and is always "online"). */
function demoOffline(): boolean {
  if (Platform.OS !== 'web') return false;
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine === false;
}
function toDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(b);
  });
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private db: DemoDB = makeSeed();
  private ready: Promise<void>;
  private listeners = new Set<Listener>();
  private authUser: AuthUser | null = null;
  private authListeners = new Set<(u: AuthUser | null) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private simTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ready = this.load();
    // seed photo captions follow the language (re-emit so open screens redraw them)
    i18next.on?.('languageChanged', () => this.emit());
    // Web: several tabs share one stored demo DB. Without this, a tab holding an older copy
    // overwrote newer data (e.g. a point credit made in another tab) on its next save.
    const w = typeof window !== 'undefined' ? (window as unknown as { addEventListener?: (t: string, f: (e: { key: string | null; newValue: string | null }) => void) => void }) : null;
    w?.addEventListener?.('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        this.db = JSON.parse(e.newValue);
        this.emit();
      } catch {
        // ignore malformed data
      }
    });
  }

  private async load() {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) this.db = refreshSeedColours(JSON.parse(raw));
      const a = await AsyncStorage.getItem(AUTH_KEY);
      if (a) this.authUser = JSON.parse(a);
    } catch {
      // ignore – fresh seed
    }
    this.startLiveSimulation();
    this.emit();
    this.authListeners.forEach((l) => l(this.authUser));
  }

  /** Simulates another scorer adding points to the seeded live match. */
  private startLiveSimulation() {
    if (this.simTimer) return;
    this.simTimer = setInterval(() => {
      const m = this.db.matches['match_live'];
      if (!m || m.status !== 'live' || m.scorerId === this.authUser?.uid) return;
      const side: Side = Math.random() < 0.5 ? 'A' : 'B';
      const roster = side === 'A' ? m.teamA.players : m.teamB.players;
      const events = addPoint(m.rules, m.events, side, {
        playerId: Math.random() < 0.6 ? roster[Math.floor(Math.random() * roster.length)]?.id : undefined,
        kind: (['kill', 'block', 'ace', 'tip'] as const)[Math.floor(Math.random() * 4)],
      });
      const st = computeState(m.rules, events, m.firstServe);
      if (st.finished) {
        // keep the demo alive: restart instead of finishing
        this.db.matches['match_live'] = { ...m, events: [], summary: summarize(computeState(m.rules, [], m.firstServe)), updatedAt: Date.now() };
      } else {
        this.db.matches['match_live'] = { ...m, events, summary: summarize(st), updatedAt: Date.now() };
      }
      this.changed();
    }, 7000);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
  private changed() {
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      AsyncStorage.setItem(KEY, JSON.stringify(this.db)).catch(() => {});
    }, 300);
  }
  /** Subscribe to a derived value; re-evaluates on every DB change. */
  private watch<T>(compute: () => T, cb: (v: T) => void): Unsubscribe {
    let last = '';
    const run = () => {
      const v = compute();
      const s = JSON.stringify(v);
      if (s !== last) {
        last = s;
        cb(v);
      }
    };
    const l = () => run();
    this.listeners.add(l);
    this.ready.then(run);
    return () => {
      this.listeners.delete(l);
    };
  }

  // ---------- auth ----------
  onAuthChanged(cb: (u: AuthUser | null) => void) {
    this.authListeners.add(cb);
    this.ready.then(() => cb(this.authUser));
    return () => {
      this.authListeners.delete(cb);
    };
  }
  async sendOtp(phone: string) {
    assertPhone(phone);
    await delay(400);
    return {
      confirm: async (code: string) => {
        await delay(300);
        if (code.trim() !== DEMO_OTP) throw new Error(`Wrong code. In demo mode the code is ${DEMO_OTP}.`);
        const existing = Object.values(this.db.users).find((u) => u.phone === phone);
        this.authUser = { uid: existing?.id ?? 'u' + phone.replace(/\D/g, ''), phoneNumber: phone };
        await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(this.authUser));
        this.authListeners.forEach((l) => l(this.authUser));
      },
    };
  }
  /** So the demo user sees how team invites work (only once they are registered). */
  private seedInviteFor(phone: string, uid: string) {
    const t = this.db.teams['team_smashers'];
    if (t && !t.pendingPhones.includes(phone) && !t.memberIds.includes(uid)) {
      t.pendingPhones = [...t.pendingPhones, phone];
      this.changed();
    }
  }
  async signOut() {
    this.authUser = null;
    await AsyncStorage.removeItem(AUTH_KEY);
    this.authListeners.forEach((l) => l(null));
  }

  // ---------- T&C (1.3.0) ----------
  private get terms(): Record<string, TermsAcceptance> {
    return (this.db.terms ??= {});
  }
  /** Like the API's requireTerms and the rules' termsOk(): every write needs the current T&C. */
  private requireTerms() {
    const me = this.authUser?.uid;
    if (!me || !termsAccepted(this.terms[me]?.version)) throw new CodedError(TERMS_NOT_ACCEPTED, TERMS_NOT_ACCEPTED_MESSAGE);
  }
  async getTerms(id: string) {
    await this.ready;
    return this.terms[id] ?? null;
  }
  async acceptTerms(id: string, version: string) {
    await this.ready;
    if (!this.authUser || this.authUser.uid !== id) throw new Error('Not signed in yet');
    if (version !== TERMS_VERSION) throw new CodedError(TERMS_VERSION_MISMATCH, 'These Terms & Conditions are out of date. Reload and try again.');
    // the first acceptance time of a version is kept
    if (this.terms[id]?.version !== version) this.terms[id] = { version, acceptedAt: Date.now() };
    this.changed();
  }
  async isAdmin(id: string) {
    return DEMO_ADMIN_UIDS.includes(id);
  }

  // ---------- profiles ----------
  watchProfile(id: string, cb: (p: UserProfile | null) => void) {
    return this.watch(() => this.db.users[id] ?? null, cb);
  }
  async saveProfile(p0: UserProfile) {
    const isNew = !this.db.users[p0.id];
    // Like the API: the Indian format is checked when the number is set or changed, so a profile from
    // before build 216 with another number can still be edited (fix-retest N4). No data is rewritten.
    this.requireTerms();
    if (isNew || this.db.users[p0.id].phone !== p0.phone) assertPhone(p0.phone);
    const p = checkProfileFields(p0);
    this.db.users[p.id] = { ...this.db.users[p.id], ...p };
    if (isNew) this.seedInviteFor(p.phone, p.id);
    this.changed();
  }
  async getProfiles(ids: string[]) {
    await this.ready;
    return ids.map((i) => this.db.users[i]).filter(Boolean);
  }
  async findUserByPhone(phone: string) {
    assertPhone(phone);
    await delay();
    return Object.values(this.db.users).find((u) => u.phone === phone) ?? null;
  }
  async uploadAvatar(_uid: string, localUri: string) {
    return localUri; // demo: keep local uri
  }
  async savePushToken(id: string, token: string) {
    if (this.db.users[id]) {
      this.db.users[id].pushToken = token;
      this.changed();
    }
  }

  // ---------- teams ----------
  async createTeam(t0: NewTeam) {
    this.requireTerms();
    const t = checkTeamFields(t0);
    const id = 'team_' + uid();
    this.db.teams[id] = { ...t, id, nameLower: t.name.toLowerCase(), createdAt: Date.now() };
    this.changed();
    return id;
  }
  async updateTeam(id: string, patch: Partial<Team>) {
    this.requireTerms();
    const t = this.db.teams[id];
    if (!t) throw new Error('Team not found');
    // Mirror firestore.rules: only registered numbers can be invited.
    const added = (patch.pendingPhones ?? []).filter((ph) => !t.pendingPhones.includes(ph));
    added.forEach(assertPhone);
    const registered = new Set(Object.values(this.db.users).map((u) => u.phone));
    if (added.some((ph) => !registered.has(ph))) throw new Error("This number isn't on VolleyLive yet. Ask them to register first.");
    patch = checkTeamFields(patch);
    this.db.teams[id] = { ...t, ...patch, id, nameLower: (patch.name ?? t.name).toLowerCase() };
    this.changed();
  }
  watchTeam(id: string, cb: (t: Team | null) => void) {
    return this.watch(() => this.db.teams[id] ?? null, cb);
  }
  watchMyTeams(id: string, cb: (t: Team[]) => void) {
    return this.watch(() => Object.values(this.db.teams).filter((t) => t.memberIds.includes(id)), cb);
  }
  watchTeamInvites(phone: string, cb: (t: Team[]) => void, onState?: (s: InviteState) => void) {
    // An account from before build 216 with a non-Indian number gets a clear state, not a silent empty list (N4).
    onState?.(inviteState(phone));
    if (inviteState(phone) !== 'ok') {
      cb([]);
      return () => {};
    }
    return this.watch(() => Object.values(this.db.teams).filter((t) => t.pendingPhones.includes(phone)), cb);
  }
  async acceptTeamInvite(teamId: string, id: string, phone: string) {
    const t = this.db.teams[teamId];
    if (!t) return;
    this.db.teams[teamId] = {
      ...t,
      memberIds: t.memberIds.includes(id) ? t.memberIds : [...t.memberIds, id],
      subIds: t.memberIds.length >= 6 ? [...t.subIds, id] : t.subIds,
      pendingPhones: t.pendingPhones.filter((p) => p !== phone),
    };
    this.changed();
  }
  async declineTeamInvite(teamId: string, phone: string) {
    const t = this.db.teams[teamId];
    if (!t) return;
    this.db.teams[teamId] = { ...t, pendingPhones: t.pendingPhones.filter((p) => p !== phone) };
    this.changed();
  }
  async searchTeams(prefix: string) {
    await this.ready;
    const p = prefix.trim().toLowerCase();
    return Object.values(this.db.teams).filter((t) => t.nameLower.startsWith(p) || t.nameLower.includes(p));
  }

  // ---------- matches ----------
  /** Same roster rules as the API server and Firestore rules (core/roster.ts). */
  private checkRoster(m: Pick<Match, 'teamA' | 'teamB' | 'status' | 'events'>, scoring = m.status === 'live' || m.events.length > 0) {
    assertRoster(m, scoring);
    if ([...m.teamA.players, ...m.teamB.players].some((p) => !this.db.users[p.id])) throw new Error(ROSTER_MESSAGES.notUser);
  }
  /** participantIds = both rosters (+ creator/scorer), as the rules and the API server require. */
  private checkParticipants(m: Pick<Match, 'teamA' | 'teamB' | 'participantIds' | 'createdBy' | 'scorerId'>) {
    if (!participantsMatchRoster(m)) throw new Error(PARTICIPANTS_MESSAGE);
  }
  async createMatch(m0: NewMatch) {
    this.requireTerms();
    // 1.3.0: scheduled/live only, captains, no POTM / finish / server fields (core/matchGuards.ts).
    const cap = (t: Match['teamA']) => (t.teamId ? this.db.teams[t.teamId]?.captainId ?? null : null);
    const { startedAt: _s, startedServerAt: _ss, ...rest } = m0;
    guardCreate(rest, { A: cap(m0.teamA), B: cap(m0.teamB) });
    // Same canonical participantIds order as the API server and firestore.rules.
    const m = checkMatchFields({ ...rest, participantIds: canonicalParticipants(m0) }, { scheduleChanged: true });
    this.checkRoster(m);
    this.checkParticipants(m);
    const id = 'match_' + uid();
    const now = Date.now();
    this.db.matches[id] = { ...m, ...stampTimes(null, m.status, now), verification: { status: 'pending' }, id, createdAt: now, updatedAt: now };
    this.changed();
    return id;
  }
  watchMatch(id: string, cb: (m: Match | null) => void) {
    return this.watch(() => this.db.matches[id] ?? null, cb);
  }
  async saveMatchProgress(id: string, p: MatchProgress) {
    const m = this.db.matches[id];
    if (!m) throw new Error('Match not found');
    if (this.authUser && m.scorerId !== this.authUser.uid) throw new Error('Only the assigned scorer can change the score');
    // 1.3.0: closed after the POTM / abandon; one-way statuses; times are the backend's own clock.
    guardProgress(m, p.status);
    this.checkRoster({ ...m, ...p });
    checkMatchFields({ events: p.events });
    // 1.3.2 parity with the API (validateEvents) and firestore.rules (creditIn): a point may only be
    // credited to a player of the team that won the rally (tap-a-player scoring).
    const rosterOf = { A: new Set(m.teamA.players.map((x) => x.id)), B: new Set(m.teamB.players.map((x) => x.id)) };
    p.events.forEach((ev, i) => {
      if (ev.type === 'point' && ev.playerId && !rosterOf[ev.side].has(ev.playerId)) throw new CodedError('bad_request', `Event ${i + 1}: ${ev.playerId} is not a player of team ${ev.side}`);
    });
    const { startedAt: _s, finishedAt: _f, playerOfMatchId: _p, ...rest } = p;
    this.db.matches[id] = { ...m, ...rest, ...stampTimes(m, p.status, Date.now()), updatedAt: Date.now() };
    this.changed();
  }
  async setPlayerOfMatch(matchId: string, playerId: string) {
    await this.ready;
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    const problem = potmProblem(m, this.authUser?.uid, playerId);
    if (problem) throw new CodedError(problem, POTM_MESSAGES[problem]);
    this.db.matches[matchId] = { ...m, playerOfMatchId: playerId, updatedAt: Date.now() };
    this.changed();
  }
  async updateMatch(id: string, patch: Partial<Match>) {
    const m = this.db.matches[id];
    if (!m) throw new Error('Match not found');
    const interestedOnly = Object.keys(patch).every((k) => k === 'interestedIds' || k === 'updatedAt');
    if (!interestedOnly) this.requireTerms();
    guardUpdate(m, patch);
    if (patch.teamA || patch.teamB || patch.participantIds) patch = { ...patch, participantIds: canonicalParticipants({ ...m, ...patch }) };
    patch = checkMatchFields(patch, { scheduleChanged: patch.scheduledAt !== undefined && patch.scheduledAt !== m.scheduledAt });
    checkOrder('finishedAt', patch.startedAt ?? m.startedAt, patch.finishedAt ?? m.finishedAt);
    const next = { ...m, ...patch };
    // A legacy match short of players may still be abandoned (only the status changes).
    const abandoning = isAbandonOnly(Object.keys(patch), next.status);
    if (patch.teamA || patch.teamB || patch.status) this.checkRoster(next, !abandoning && (next.status === 'live' || next.events.length > 0));
    if (patch.teamA || patch.teamB || patch.participantIds) this.checkParticipants(next);
    const now = Date.now();
    const times = patch.status && patch.status !== m.status ? { ...stampTimes(m, patch.status, now), ...(patch.status === 'abandoned' ? { finishedAt: now } : {}) } : {};
    this.db.matches[id] = { ...m, ...patch, ...times, id, updatedAt: now };
    this.changed();
  }
  watchLiveMatches(cb: (m: Match[]) => void) {
    return this.watch(
      () => Object.values(this.db.matches).filter((m) => m.status === 'live' || m.status === 'scheduled').sort((a, b) => b.updatedAt - a.updatedAt),
      cb,
    );
  }
  watchMyMatches(id: string, cb: (m: Match[]) => void) {
    return this.watch(
      () => Object.values(this.db.matches).filter((m) => m.participantIds.includes(id)).sort((a, b) => b.updatedAt - a.updatedAt),
      cb,
    );
  }
  watchTournamentMatches(tid: string, cb: (m: Match[]) => void) {
    return this.watch(() => Object.values(this.db.matches).filter((m) => m.tournamentId === tid), cb);
  }
  async listPublicMatches() {
    await this.ready;
    return Object.values(this.db.matches).filter((m) => (m.status === 'live' || m.status === 'scheduled') && m.location);
  }

  // ---------- photos ----------
  watchPhotos(matchId: string, cb: (p: MatchPhoto[]) => void) {
    return this.watch(
      () => Object.values(this.db.photos).filter((p) => p.matchId === matchId).sort((a, b) => b.createdAt - a.createdAt).map(localizedPhoto),
      cb,
    );
  }
  /**
   * Demo mode behaves like the real backends (1.1.0 browser pass): the photo is read and checked on
   * the client (type allow-list, magic bytes, size), only the signed-in user's queued photos are
   * accepted, progress is reported, and while the browser is offline the upload fails like a network
   * error so the queue chip shows "Waiting for network" instead of "Photo added". The idempotency
   * key makes a retried photo land once.
   */
  async uploadMatchPhoto(matchId: string, by: string, localUri: string, onProgress?: UploadProgress, opts?: UploadOptions) {
    await this.ready;
    if (!this.authUser) throw new Error('Not signed in yet');
    if (this.authUser.uid !== by) throw new CodedError(PHOTO_WRONG_ACCOUNT, 'This photo was added by another account');
    if (demoOffline()) throw new TypeError('Network request failed (offline)');
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    if (!canAddMatchPhoto(m, by)) throw new CodedError(PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE);
    const key = opts?.idempotencyKey && IDEMPOTENCY_KEY_RE.test(opts.idempotencyKey) ? opts.idempotencyKey : null;
    const id = key ? 'ph_' + key : 'ph_' + uid();
    if (this.db.photos[id]) return onProgress?.(1);
    const photo = await readPhoto(localUri);
    onProgress?.(0.5);
    // A web blob: URL dies with the page: keep small photos as data: URLs so they survive a reload.
    const url = Platform.OS === 'web' && localUri.startsWith('blob:') && photo.size <= 600_000 ? await toDataUrl(photo.blob).catch(() => localUri) : localUri;
    this.db.photos[id] = { id, matchId, url, uploadedBy: by, createdAt: Date.now() };
    onProgress?.(1);
    this.changed();
  }
  async deleteMatchPhoto(photo: MatchPhoto) {
    await this.ready;
    const p = this.db.photos[photo.id];
    if (!p) return;
    if (p.uploadedBy !== this.authUser?.uid) throw new CodedError(PHOTO_NOT_ALLOWED, 'Only the person who added a photo can delete it');
    delete this.db.photos[photo.id];
    this.changed();
  }
  async listMemories(userId: string) {
    await this.ready;
    const played = new Set(
      Object.values(this.db.matches)
        .filter((m) => [...m.teamA.players, ...m.teamB.players].some((p) => p.id === userId))
        .map((m) => m.id),
    );
    return Object.values(this.db.photos)
      .filter((p) => played.has(p.matchId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60)
      .map(localizedPhoto);
  }

  // ---------- rankings ----------
  async getRankings(userId: string): Promise<RankingsResult> {
    await this.ready;
    // 1.3.0: counted matches only (completed + verified + not flagged + IST caps, core/antifraud.ts)
    const all = Object.values(this.db.matches);
    const totals = countedTotals(all);
    const r = rankPlayers(totals);
    const myCountedMatchIds = countedMatchIdsFor(countMatches(all).counted, userId);
    return { ranked: r.ranked, total: r.total, minMatches: MIN_RANKED_MATCHES, me: rowFor(r, userId, totals.find((x) => x.playerId === userId)), myCountedMatchIds };
  }
  async getWallet(userId: string): Promise<WalletResult> {
    await this.ready;
    return playerWallet(Object.values(this.db.matches), userId);
  }

  // ---------- result confirmation / admin review (1.3.0) ----------
  private verifyAs(matchId: string, status: 'confirmed' | 'disputed', reason?: string) {
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    const me = this.authUser?.uid ?? '';
    this.requireTerms();
    const problem = confirmProblem(m, me);
    if (problem) throw new CodedError(problem, CONFIRM_MESSAGES[problem]);
    this.db.matches[matchId] = { ...m, verification: { status, by: me, at: Date.now(), ...(reason ? { reason } : {}) }, updatedAt: Date.now() };
    this.changed();
  }
  async confirmResult(matchId: string) {
    await this.ready;
    this.verifyAs(matchId, 'confirmed');
  }
  async rejectResult(matchId: string, reason: string) {
    await this.ready;
    const r = checkText('reason', reason ?? '', 'rejectReason');
    this.verifyAs(matchId, 'disputed', r || undefined);
  }
  async reviewMatch(matchId: string, decision: ReviewDecision) {
    await this.ready;
    const me = this.authUser?.uid ?? '';
    if (!(await this.isAdmin(me))) throw new CodedError('admin_only', 'Only an admin can review a match');
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    const v = verificationStatus(m);
    if (!isCompleted(m)) throw new CodedError('not_completed', CONFIRM_MESSAGES.not_completed);
    if (v === 'approved' || v === 'voided') throw new CodedError('already_reviewed', CONFIRM_MESSAGES.already_reviewed);
    this.db.matches[matchId] = { ...m, verification: { ...(m.verification ?? { status: 'pending' }), status: decision === 'approve' ? 'approved' : 'voided', reviewedBy: me, reviewedAt: Date.now() }, updatedAt: Date.now() };
    this.changed();
  }
  async listFlagged() {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) return [];
    return Object.values(this.db.matches).filter(needsReview).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  }

  // ---------- challenges ----------
  async createChallenge(c0: NewChallenge) {
    this.requireTerms();
    const problem = challengeProblem(c0, this.db.teams[c0.fromTeamId], this.db.teams[c0.toTeamId], this.authUser?.uid ?? null);
    if (problem) throw new Error(problem);
    // Names come from the team records (QA G19), like the API and firestore.rules.
    const c = { ...checkChallengeFields(c0), fromTeamName: this.db.teams[c0.fromTeamId].name, toTeamName: this.db.teams[c0.toTeamId].name };
    const id = 'ch_' + uid();
    this.db.challenges[id] = { ...c, id, status: 'pending', matchId: null, createdAt: Date.now() };
    this.changed();
    return id;
  }
  watchChallenges(teamIds: string[], cb: (c: Challenge[]) => void) {
    return this.watch(
      () =>
        Object.values(this.db.challenges)
          .filter((c) => teamIds.includes(c.fromTeamId) || teamIds.includes(c.toTeamId))
          .sort((a, b) => b.createdAt - a.createdAt),
      cb,
    );
  }
  async respondToChallenge(c: Challenge, status: Challenge['status'], matchId?: string) {
    if (status === 'accepted') {
      const [from, to] = [this.db.teams[c.fromTeamId], this.db.teams[c.toTeamId]];
      if (!from || !to || !teamCanPlay(from) || !teamCanPlay(to)) throw new Error(TEAM_TOO_SMALL_MESSAGE);
    }
    this.db.challenges[c.id] = { ...this.db.challenges[c.id], status, matchId: matchId ?? null };
    this.changed();
  }

  // ---------- tournaments ----------
  async createTournament(t0: NewTournament) {
    this.requireTerms();
    const t = checkTournamentFields(t0, { startChanged: true });
    const problem = tournamentTeamsProblem(t.teams, (id) => this.db.teams[id]);
    if (problem) throw new Error(problem);
    const id = 'tour_' + uid();
    this.db.tournaments[id] = { ...t, id, createdAt: Date.now() };
    this.changed();
    return id;
  }
  async updateTournament(id: string, patch: Partial<Tournament>) {
    const t = this.db.tournaments[id];
    if (!t) throw new Error('Tournament not found');
    if (this.authUser && t.organizerId !== this.authUser.uid) throw new Error(TOURNAMENT_ORGANIZER_MESSAGE);
    if (patch.organizerId && patch.organizerId !== t.organizerId) throw new Error(TOURNAMENT_ORGANIZER_MESSAGE);
    const merged = { ...t, ...patch };
    checkTournamentFields({ ...patch, startDate: merged.startDate, endDate: merged.endDate }, { startChanged: patch.startDate !== undefined && patch.startDate !== t.startDate });
    if (patch.teams) {
      const problem = tournamentTeamsProblem(patch.teams, (tid) => this.db.teams[tid]);
      if (problem) throw new Error(problem);
    }
    this.db.tournaments[id] = { ...this.db.tournaments[id], ...patch, id };
    this.changed();
  }
  watchTournament(id: string, cb: (t: Tournament | null) => void) {
    return this.watch(() => this.db.tournaments[id] ?? null, cb);
  }
  watchTournaments(cb: (t: Tournament[]) => void) {
    return this.watch(() => Object.values(this.db.tournaments).sort((a, b) => b.startDate - a.startDate), cb);
  }

  // ---------- courts ----------
  async addCourt(c0: NewCourt) {
    this.requireTerms();
    const c = checkCourtFields(c0);
    const id = 'court_' + uid();
    this.db.courts[id] = { ...c, id, createdAt: Date.now() } as Court;
    this.changed();
    return id;
  }
  async listCourts() {
    await this.ready;
    return Object.values(this.db.courts);
  }

  /**
   * Demo only: wipe local data back to the sample seed and sign out. The signed-in user may not
   * exist in the fresh seed, which used to leave them on "Create your profile" with no way back
   * to the login screen (QA bug H).
   */
  async reset() {
    this.db = makeSeed();
    await AsyncStorage.removeItem(KEY);
    this.changed();
    await this.signOut();
  }
}
