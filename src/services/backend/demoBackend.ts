import { askLocally } from '../askLocal';
import { assertSupportImage, checkSupportStatus, checkSupportTicket, SUPPORT_IMAGE_TYPES, supportRateWait, type NewSupportTicket, type SupportStatus, type SupportTicket } from '../../core/support';
import { checkFeedback, REVIEW_LAST_ASKED_PREFIX } from '../../core/reviewPrompt';
import { BUNDLED_DAILY_ITEMS, checkDailyItem, dailyTombstone, type DailyItem } from '../../core/dailyItems';
/**
 * Demo backend: an in-memory database with sample data, persisted to
 * AsyncStorage. Lets you try every screen without a Firebase project.
 * OTP code is always 123456.
 */
import { checkRegistrationUpdate, demoPincodeLookup, emailKey, fullName, hasStoredRegistration, sentRegistration } from '../../core/registration';
import { MIN_AGE } from '../config';
import { repairPatch, type RepairFix } from '../../core/verdictRepair';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_ADMIN_UIDS, DEMO_MODE, DEMO_OTP } from '../config';
import { addPoint, computeState, summarize, type Side } from '../../core/scoring';
import { assertTournamentAdmin, guardTournamentEdit, NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE, TOURNAMENT_LINK_KEYS, tournamentLinkProblem } from '../../core/tournamentAdmin';
import { assertRoster, TEAM_SIZE_MODES, canonicalParticipants, challengeProblem, isAbandonOnly, PARTICIPANTS_MESSAGE, participantsMatchRoster, ROSTER_MESSAGES, teamCanPlay, TEAM_TOO_SMALL_MESSAGE, tournamentTeamsProblem } from '../../core/roster';
import type { Challenge, Court, Match, MatchPhoto, Team, Tournament, UserProfile } from '../../core/types';
import { DEMO_QA_ADMIN, DemoDB, demoPhotoUrl, demoQaAdminProfile, makeSeed, refreshSeedColours, SEED_PHOTO_SCENES } from './demoSeed';
import i18next from 'i18next';
import type { AuthUser, Backend, MatchProgress, NewChallenge, NewCourt, NewMatch, NewTeam, NewTournament, RankingsResult, ReviewDecision, Unsubscribe, UploadOptions, UploadProgress, WalletResult } from './types';
import { POTM_MESSAGES, potmProblem } from '../../core/potm';
import { MIN_RANKED_MATCHES, rankPlayers, rowFor } from '../../core/ranking';
import { byMatchDateDesc, CAPTAIN_MESSAGES, captainsProblem, CONFIRM_MESSAGES, captainVerdict, currentVerification, confirmProblem, countMatches, countedMatchIdsFor, countedTotals, isCompleted, needsReview, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE, ownMatchReview, playerWallet, verificationStatus } from '../../core/antifraud';
import { GUARD_MESSAGES, guardCreate, guardProgress, guardUpdate, MATCH_STATUS_MOVE, verdictSetupChanged, matchOver, rulesEndProblem, stampTimes } from '../../core/matchGuards';
import { abandonPatch, answerAbandon, needsAdminAction, nextMaxEvents, planAbandon, reportAbandon, resolvePatch, type AbandonAnswer, type ResolveAction } from '../../core/abandon';
import { eligibleHandoffAdmins, HANDOVER_MESSAGES, handoverProblem, reassignProblem, reassignRecord } from '../../core/scorerHandoff';
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
import { blobSha256, readPhoto } from '../photoFile';
import { connectivity } from '../connectivity';
import { offCourtCredit } from '../../core/rotation';
import { MAX_PHOTOS_PER_MATCH } from '../../core/limits';
import { PHOTO_ERROR_CODES } from '../../core/photos';

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

const QA_ADMIN_KEY = 'volleylive-demo-qa-admin-v1';

/**
 * Browser offline, or the demo-only "Simulate offline" switch (services/connectivity.ts).
 * 1.3.5 (QA E134-1): on the web a demo save is local, so it never failed on its own and a save made
 * while the network was down was reported as "✓ Synced". It now also checks that the app's own web
 * server answers (connectivity.reachable) before accepting a write, like a real backend would.
 */
async function demoOffline(): Promise<boolean> {
  if (connectivity.isSimulatedOffline()) return true;
  if (Platform.OS !== 'web') return false;
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  if (nav?.onLine === false) return true;
  return !(await connectivity.reachable());
}
const SIM_OFFLINE_KEY = 'volleylive-demo-sim-offline-v1';
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
  /** 1.3.4 QA access: accounts switched to "Demo admin" in Profile (demo builds only, this phone only). */
  private qaAdmins = new Set<string>();

  constructor() {
    if (DEMO_MODE) {
      connectivity.onSimulatedChange((on) => {
        (on ? AsyncStorage.setItem(SIM_OFFLINE_KEY, '1') : AsyncStorage.removeItem(SIM_OFFLINE_KEY)).catch(() => {});
      });
    }
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
      // 1.3.5: demo data saved by an older build gets the demo admin account too (unless its number
      // was already registered by someone, who then simply isn't an admin).
      if (!this.db.users[DEMO_QA_ADMIN.id] && !Object.values(this.db.users).some((u) => u.phone === DEMO_QA_ADMIN.phone)) {
        this.db.users[DEMO_QA_ADMIN.id] = demoQaAdminProfile();
      }
      const a = await AsyncStorage.getItem(AUTH_KEY);
      if (a) this.authUser = JSON.parse(a);
      const q = await AsyncStorage.getItem(QA_ADMIN_KEY);
      if (q) this.qaAdmins = new Set((JSON.parse(q) as unknown[]).filter((x): x is string => typeof x === 'string'));
      // 1.3.5: "Simulate offline" survives a reload (demo builds only).
      if (DEMO_MODE && (await AsyncStorage.getItem(SIM_OFFLINE_KEY)) === '1') connectivity.setSimulatedOffline(true);
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
        // (1.4.5: a fresh simulated match – its latches start again)
        this.db.matches['match_live'] = { ...m, events: [], maxEvents: 0, wasWon: false, summary: summarize(computeState(m.rules, [], m.firstServe)), updatedAt: Date.now() };
      } else {
        this.db.matches['match_live'] = { ...m, events, maxEvents: Math.max(m.maxEvents ?? m.events.length, events.length), summary: summarize(st), updatedAt: Date.now() };
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
  /** 1.4.6 (QA V145-17): the demo admins (DEMO_ADMIN_UIDS + this phone's QA admin) with a profile. */
  async handoffAdmins(matchId: string) {
    const m = this.db.matches[matchId];
    if (!m) throw new CodedError('not_found', 'Match not found');
    const me = this.authUser?.uid ?? '';
    if (me !== m.createdBy && me !== m.scorerId) throw new CodedError('forbidden', 'Only the creator or the scorer can hand scoring over');
    const admins: { id: string; name: string }[] = [];
    for (const u of Object.values(this.db.users)) if (await this.isHandoffAdmin(u.id)) admins.push({ id: u.id, name: u.name });
    return eligibleHandoffAdmins(m, admins).sort((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * 1.4.7 (QA V146-9): who counts as an admin for the scorer handoff. 1.4.6 used isAdmin, true for the demo admin
   * account only while THIS phone had switched admin mode on – so on the scorer's phone the list was empty although
   * the hint promised "or an admin". The demo admin account is the demo's admin, as ADMIN_UIDS on the API.
   */
  async isHandoffAdmin(id: string) {
    return (await this.isAdmin(id)) || this.canBeDemoAdmin(id);
  }
  async isAdmin(id: string) {
    return DEMO_ADMIN_UIDS.includes(id) || this.isDemoAdmin(id);
  }
  /**
   * 1.3.4/1.3.5 QA access, demo builds only: the fixed demo admin account (DEMO_QA_ADMIN,
   * +919000000001, in no team or match) may switch itself to admin to review flagged matches in the
   * browser. Nobody else can (QA E134-2), and outside DEMO_MODE it doesn't exist (the demo backend is
   * never created in an API/Firebase build, and every entry point checks DEMO_MODE again). No account,
   * password or key is created: it is a flag on this phone's local demo data. Real admins: API
   * ADMIN_UIDS on the server; Firebase: the operator-set custom claim.
   */
  canBeDemoAdmin(id: string | null | undefined) {
    return DEMO_MODE && !!id && id === DEMO_QA_ADMIN.id && this.db.users[id]?.phone === DEMO_QA_ADMIN.phone;
  }
  isDemoAdmin(id: string) {
    return this.canBeDemoAdmin(id) && this.qaAdmins.has(id);
  }
  async setDemoAdmin(on: boolean) {
    await this.ready;
    if (!DEMO_MODE) throw new Error('Demo admin is only available in demo mode');
    const uid = this.authUser?.uid;
    if (!uid) throw new Error('Not signed in yet');
    if (!this.canBeDemoAdmin(uid)) throw new Error(`Only the demo admin account (${DEMO_QA_ADMIN.phone}) can do this`);
    if (on) this.qaAdmins.add(uid);
    else this.qaAdmins.delete(uid);
    await AsyncStorage.setItem(QA_ADMIN_KEY, JSON.stringify([...this.qaAdmins])).catch(() => {});
    this.emit();
  }

  // ---------- profiles ----------
  /**
   * 1.3.7 privacy: date of birth, email, pincode, district and state are the owner's only (as the API
   * returns them). The demo's sample users are synthetic, and nothing hands their private fields to
   * another signed-in account.
   */
  private visible(u: UserProfile | undefined | null): UserProfile | null {
    if (!u) return null;
    if (u.id === this.authUser?.uid) return u;
    const { dob: _d, email: _e, pincode: _p, district: _di, state: _s, ...pub } = u;
    return pub;
  }
  watchProfile(id: string, cb: (p: UserProfile | null) => void) {
    return this.watch(() => this.visible(this.db.users[id]), cb);
  }
  async saveProfile(p0: UserProfile) {
    const isNew = !this.db.users[p0.id];
    // Like the API: the Indian format is checked when the number is set or changed, so a profile from
    // before build 216 with another number can still be edited (fix-retest N4). No data is rewritten.
    this.requireTerms();
    if (isNew || this.db.users[p0.id].phone !== p0.phone) assertPhone(p0.phone);
    const stored = this.db.users[p0.id];
    // 1.3.6/1.3.7: same registration checks as the API server (pincode: bundled sample, format otherwise).
    // Every field sent is checked together with the stored ones (R136-3); `name` is always first + last
    // once they exist (R136-12); district/state only come from the pincode lookup (R136-13).
    let p: UserProfile;
    if (sentRegistration(p0)) {
      const f = checkRegistrationUpdate(p0, stored, MIN_AGE);
      // 1.4.0 (QA V139-3): one email per account, like the API (case/spaces only, NFC).
      // 1.4.1 (V140-3): the account's own unchanged address (up to normalisation) is never refused.
      const key = emailKey(f.email);
      if (key && key !== emailKey(stored?.email) && Object.values(this.db.users).some((u) => u.id !== p0.id && emailKey(u.email) === key))
        throw Object.assign(new CodedError('email_taken', 'This email is already used by another account.'), { field: 'email' });
      const found = demoPincodeLookup(f.pincode);
      if (found.status === 'invalid') throw new CodedError('pincode_unknown', 'Unknown pincode');
      p = checkProfileFields({ ...p0, ...f, name: fullName(f.firstName, f.lastName), district: found.status === 'ok' ? found.district : null, state: found.status === 'ok' ? found.state : null });
    } else if (hasStoredRegistration(stored)) {
      p = checkProfileFields({ ...p0, name: fullName(stored.firstName!, stored.lastName!) });
    } else {
      p = checkProfileFields(p0);
    }
    this.db.users[p.id] = { ...this.db.users[p.id], ...p };
    if (isNew) this.seedInviteFor(p.phone, p.id);
    this.changed();
  }
  async getProfiles(ids: string[]) {
    await this.ready;
    return ids.map((i) => this.visible(this.db.users[i])).filter((u): u is UserProfile => !!u);
  }
  async findUserByPhone(phone: string) {
    assertPhone(phone);
    await delay();
    return this.visible(Object.values(this.db.users).find((u) => u.phone === phone));
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
  private checkRoster(m: Pick<Match, 'teamA' | 'teamB' | 'status' | 'events' | 'teamSizeMode'>, scoring = m.status === 'live' || m.events.length > 0) {
    // 1.3.7 (R136-4): like the API's zod enum, only 'exact' / 'custom' (or none = custom, before 1.3.6)
    if (m.teamSizeMode != null && !TEAM_SIZE_MODES.includes(m.teamSizeMode)) throw new CodedError('bad_request', 'Invalid team size mode');
    assertRoster(m, scoring);
    if ([...m.teamA.players, ...m.teamB.players].some((p) => !this.db.users[p.id])) throw new Error(ROSTER_MESSAGES.notUser);
  }
  /** participantIds = both rosters (+ creator/scorer), as the rules and the API server require. */
  private checkParticipants(m: Pick<Match, 'teamA' | 'teamB' | 'participantIds' | 'createdBy' | 'scorerId'>) {
    if (!participantsMatchRoster(m)) throw new Error(PARTICIPANTS_MESSAGE);
  }
  async createMatch(m0: NewMatch) {
    this.requireTerms();
    // 1.3.8 (QA V137-2): like the API, only a complete profile (name, date of birth, pincode) creates a match
    const meProfile = this.db.users[this.authUser?.uid ?? ''];
    if (!meProfile || !hasStoredRegistration({ firstName: meProfile.firstName ?? null, lastName: meProfile.lastName ?? null, dob: meProfile.dob ?? null, pincode: meProfile.pincode ?? null }))
      throw new CodedError('profile_incomplete', 'Complete your profile (name, date of birth and pincode) to create a match');
    // 1.3.0: scheduled/live only, captains, no POTM / finish / server fields (core/matchGuards.ts).
    const cap = (t: Match['teamA'] | null | undefined) => (t?.teamId ? this.db.teams[t.teamId]?.captainId ?? null : null);
    const { startedAt: _s, startedServerAt: _ss, ...rest } = m0;
    guardCreate(rest, { A: cap(m0.teamA), B: cap(m0.teamB) });
    // 1.4.19: only the tournament's owner links a match to it (the link feeds the standings)
    const lp = tournamentLinkProblem(null, m0, this.authUser?.uid, (tid) => this.db.tournaments[tid]);
    if (lp) throw new CodedError(lp, NOT_TOURNAMENT_ADMIN_MESSAGE);
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
    await this.ready; // the stored "Simulate offline" switch is restored first
    if (await demoOffline()) throw new TypeError('Network request failed (offline)');
    const m = this.db.matches[id];
    if (!m) throw new Error('Match not found');
    if (this.authUser && m.scorerId !== this.authUser.uid) throw new Error('Only the assigned scorer can change the score');
    // 1.3.0: closed after the POTM / abandon; one-way statuses; times are the backend's own clock.
    // 1.4.3 (QA V142-7, API parity): the status follows the events – the winning rally makes the match finished
    // (a client that still says "live" can't keep it open to abandon or edit it later)
    if (computeState(m.rules, p.events, m.firstServe).finished) p = { ...p, status: 'finished' };
    // 1.4.4 (QA V143-8, API parity): 'finished' without a winner in the events is ignored – the match stays live
    // (the API derives the status from the events the same way)
    else if (p.status === 'finished') p = { ...p, status: 'live' };
    guardProgress(m, p.status, p.events); // 1.4.2 (V141-8): a finished match's score never changes
    this.checkRoster({ ...m, ...p });
    checkMatchFields({ events: p.events });
    // 1.3.2 parity with the API (validateEvents) and firestore.rules (creditIn): a point may only be
    // credited to a player of the team that won the rally (tap-a-player scoring).
    const rosterOf = { A: new Set(m.teamA.players.map((x) => x.id)), B: new Set(m.teamB.players.map((x) => x.id)) };
    p.events.forEach((ev, i) => {
      if (ev.type === 'point' && ev.playerId && !rosterOf[ev.side].has(ev.playerId)) throw new CodedError('bad_request', `Event ${i + 1}: ${ev.playerId} is not a player of team ${ev.side}`);
    });
    // 1.3.4 (QA D133-5): a NEW credited point must name a player who was on court for that rally
    // (set lineup + rotation; same check as the API server). Earlier events are left as they are.
    let firstDiff = 0;
    while (firstDiff < m.events.length && firstDiff < p.events.length && JSON.stringify(m.events[firstDiff]) === JSON.stringify(p.events[firstDiff])) firstDiff++;
    const bench = offCourtCredit(m.rules, p.events, m.firstServe, { A: m.teamA.players.map((x) => x.id), B: m.teamB.players.map((x) => x.id) }, m.lineups, firstDiff);
    if (bench) throw new CodedError('not_on_court', `Event ${bench.index + 1}: ${bench.playerId} was not on court for team ${bench.side}`);
    // 1.3.4 (QA D133-6): like the API server, the summary is always recomputed from the events; any
    // totals the client sent are ignored.
    const summary = summarize(computeState(m.rules, p.events, m.firstServe));
    const { startedAt: _s, finishedAt: _f, playerOfMatchId: _p, summary: _clientSummary, ...rest } = p;
    // 1.4.5 (QA V144-1): maxEvents only grows (undo never lowers it); wasWon latches once finished
    const marks = { maxEvents: nextMaxEvents(m, p.events), wasWon: !!m.wasWon || p.status === 'finished' };
    this.db.matches[id] = { ...m, ...rest, ...marks, summary, ...stampTimes(m, p.status, Date.now()), updatedAt: Date.now() };
    this.changed();
  }
  // ---------- 1.4.5 (QA V144-1/2/3): abandon, consent request, admin resolution (src/core/abandon.ts) ----------
  private applyAction(id: string, m: Match, patch: Partial<Match>) {
    const now = Date.now();
    const times: Partial<Match> = {};
    if (patch.status === 'finished') Object.assign(times, { finishedAt: now, finishedServerAt: now, wasWon: true });
    else if (patch.status === 'live') Object.assign(times, { finishedAt: null, finishedServerAt: null });
    else if (patch.status === 'abandoned') Object.assign(times, { finishedAt: now, finishedServerAt: null });
    this.db.matches[id] = { ...m, ...patch, ...times, updatedAt: now };
    this.changed();
  }
  async abandonMatch(matchId: string) {
    await this.ready;
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    this.requireTerms();
    const plan = planAbandon(m, this.authUser?.uid ?? '', Date.now());
    this.applyAction(matchId, m, abandonPatch(plan, Date.now()));
    return plan.kind === 'request' ? ('requested' as const) : ('abandoned' as const);
  }
  async answerAbandonRequest(matchId: string, action: AbandonAnswer) {
    await this.ready;
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    this.requireTerms();
    this.applyAction(matchId, m, answerAbandon(m, this.authUser?.uid ?? '', action, Date.now()));
  }
  async resolveMatch(matchId: string, action: ResolveAction) {
    await this.ready;
    const me = this.authUser?.uid ?? '';
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    this.applyAction(matchId, m, resolvePatch(m, me, await this.isAdmin(me), action, Date.now()));
  }
  async reportAbandon(matchId: string) {
    await this.ready;
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    this.requireTerms();
    this.applyAction(matchId, m, reportAbandon(m, this.authUser?.uid ?? '', Date.now()));
  }
  async reassignScorer(matchId: string, scorerId: string) {
    await this.ready;
    const me = this.authUser?.uid ?? '';
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    const p = reassignProblem(m, me, await this.isAdmin(me), scorerId);
    if (p) throw new CodedError(p, HANDOVER_MESSAGES[p] ?? GUARD_MESSAGES[p] ?? p);
    const rec = reassignRecord(m, me, scorerId, Date.now());
    this.db.matches[matchId] = { ...m, scorerId, ...(rec ? { scorerReassign: rec } : {}), updatedAt: Date.now() };
    this.changed();
  }
  async repairVerdict(matchId: string, fix: RepairFix) {
    await this.ready;
    const me = this.authUser?.uid ?? '';
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    this.db.matches[matchId] = { ...m, ...repairPatch(m, me, await this.isAdmin(me), fix, Date.now()), updatedAt: Date.now() };
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
    // 1.4.19: a match's tournament link never changes after create
    // (a finished / abandoned match keeps its frozen-field codes: tournamentId / fixtureId are frozen there)
    if ((m.status === 'scheduled' || m.status === 'live') && TOURNAMENT_LINK_KEYS.some((k) => k in patch)) {
      const lp = tournamentLinkProblem(m, { tournamentId: 'tournamentId' in patch ? patch.tournamentId : m.tournamentId, fixtureId: 'fixtureId' in patch ? patch.fixtureId : m.fixtureId }, this.authUser?.uid, (tid) => this.db.tournaments[tid]);
      if (lp) throw new CodedError(lp, NOT_TOURNAMENT_ADMIN_MESSAGE);
    }
    // 1.4.5 (QA V144-1): {status: 'abandoned'} is the abandon action (records who, when, the score; policy switch)
    if (patch.status === 'abandoned' && (m.status === 'live' || m.status === 'scheduled')) {
      if (Object.keys(patch).some((k) => k !== 'status' && k !== 'updatedAt')) throw new CodedError(MATCH_STATUS_MOVE, GUARD_MESSAGES[MATCH_STATUS_MOVE]);
      await this.abandonMatch(id);
      return;
    }
    // 1.4.13: the captains' shape first (guardUpdate's verdict check would call a half pair 'match_no_verdict'); a
    // finished / abandoned match keeps its frozen-field codes
    if (m.status !== 'finished' && m.status !== 'abandoned' && patch.captains !== undefined && !(patch.captains == null && m.captains == null)) {
      const c = patch.captains as { A?: unknown; B?: unknown } | null;
      if (!c || typeof c.A !== 'string' || typeof c.B !== 'string' || !c.A || !c.B) throw new CodedError('captains_required', CAPTAIN_MESSAGES.captains_required);
      // 1.4.13 (QA V1412-4): only the A and B keys (API / rules)
      if (Object.keys(c).some((k) => k !== 'A' && k !== 'B')) throw new CodedError('captains_required', CAPTAIN_MESSAGES.captains_required);
    }
    guardUpdate(m, patch);
    // 1.4.12 (QA V1411-3, API / rules parity; after guardUpdate's frozen / lock codes): the creator never changes (API 403, rules matchKeysOk), and the captains
    // can't be cleared or left half-set (API / rules 400 captains_required) – an older doc without captains may keep null
    if (patch.createdBy !== undefined && patch.createdBy !== m.createdBy) throw new CodedError('forbidden', 'The creator of a match can\u2019t change');
    // 1.4.13 (QA V1412-4, API parity): a set-up change (players, captains, a side's team…) re-checks the captains like the
    // API writeMatch – a captain who isn't a player of their side (e.g. an unknown id) or not the registered team's captain
    if (verdictSetupChanged(m, { ...m, ...patch } as Match)) {
      const cap = (t: Match['teamA']) => (t?.teamId ? this.db.teams[t.teamId]?.captainId ?? null : null);
      const nx = { ...m, ...patch } as Match;
      const cp = nx.captains ? captainsProblem(nx, { A: cap(nx.teamA), B: cap(nx.teamB) }) : null;
      if (cp) throw new CodedError(cp, CAPTAIN_MESSAGES[cp]);
    }
    // 1.4.6 (QA V145, API parity – decideMatchUpdate / firestore.rules): only the scorer edits a match; the creator or
    // the scorer may hand scoring over (that field only); anyone may toggle their own "I want to play".
    const me = this.authUser?.uid;
    if (me && !interestedOnly && me !== m.scorerId) {
      const handover = Object.keys(patch).every((k) => k === 'scorerId' || k === 'updatedAt') && me === m.createdBy;
      if (!handover) throw new CodedError('forbidden', 'Only the scorer can change this match');
    }
    // 1.4.5 (QA V144-8, interim): after the first rally scoring goes only to the scorer's own side (or an admin)
    if (patch.scorerId !== undefined && patch.scorerId !== m.scorerId) {
      const hp = handoverProblem(m, patch.scorerId, { targetIsAdmin: await this.isHandoffAdmin(patch.scorerId) });
      if (hp) throw new CodedError(hp, HANDOVER_MESSAGES[hp]);
    }
    // 1.4.4 (QA V143-8, API parity): new rules / first serve can't turn a live match into a won one
    const rulesEnd = rulesEndProblem(m, patch);
    if (rulesEnd) throw new CodedError(rulesEnd, GUARD_MESSAGES[rulesEnd]);
    if (patch.teamA || patch.teamB || patch.participantIds) patch = { ...patch, participantIds: canonicalParticipants({ ...m, ...patch }) };
    patch = checkMatchFields(patch, { scheduleChanged: patch.scheduledAt !== undefined && patch.scheduledAt !== m.scheduledAt, status: m.status });
    checkOrder('finishedAt', patch.startedAt ?? m.startedAt, patch.finishedAt ?? m.finishedAt);
    const next = { ...m, ...patch };
    // 1.3.7 (R136-4/5, API parity): players and the team size mode are fixed after the first rally.
    // 1.4.6 (QA V145-3): teams, participants, captains and team size are part of guardUpdate's set-up lock
    // (match_setup_locked once maxEvents > 0, also after undo to 0) – the same check on every backend.
    // A legacy match short of players may still be abandoned (only the status changes).
    const abandoning = isAbandonOnly(Object.keys(patch), next.status);
    if (patch.teamA || patch.teamB || patch.status || patch.teamSizeMode !== undefined) this.checkRoster(next, !abandoning && (next.status === 'live' || next.events.length > 0));
    if (patch.teamA || patch.teamB || patch.participantIds) this.checkParticipants(next);
    // 1.4.3 (QA V142-3, API parity): the summary is never taken from the client – it is recomputed from the
    // events whenever they, the rules or the first serve change (a finished match can't change any of them:
    // guardUpdate → finishedFreezeProblem), and 'finished' needs a winner in the event log.
    const { summary: _clientSummary, ...rest } = patch;
    const summary = rest.events || rest.rules || rest.firstServe ? summarize(computeState(next.rules, next.events, next.firstServe)) : m.summary;
    if (next.status === 'finished' && (rest.status || rest.events || rest.rules || rest.firstServe) && !computeState(next.rules, next.events, next.firstServe).winner)
      throw new CodedError('match_no_winner', 'A match can only finish when a team has won the required sets');
    const now = Date.now();
    const times = patch.status && patch.status !== m.status ? { ...stampTimes(m, patch.status, now), ...(patch.status === 'abandoned' ? { finishedAt: now } : {}) } : {};
    // 1.4.6 (QA V145-7): every write path keeps the latches – maxEvents only grows, wasWon only latches (also here)
    const marks = { maxEvents: nextMaxEvents(m, next.events), wasWon: !!m.wasWon || next.status === 'finished' };
    this.db.matches[id] = { ...m, ...rest, summary, ...times, ...marks, id, updatedAt: now };
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
      // 1.3.9 (V138-11): by the match's own date (a confirmation bumps updatedAt, not the date)
      () => Object.values(this.db.matches).filter((m) => m.participantIds.includes(id)).sort(byMatchDateDesc),
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
    if (await demoOffline()) throw new TypeError('Network request failed (offline)');
    const m = this.db.matches[matchId];
    if (!m) throw new Error('Match not found');
    if (!canAddMatchPhoto(m, by)) throw new CodedError(PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE);
    const key = opts?.idempotencyKey && IDEMPOTENCY_KEY_RE.test(opts.idempotencyKey) ? opts.idempotencyKey : null;
    const id = key ? 'ph_' + key : 'ph_' + uid();
    if (this.db.photos[id]) return onProgress?.(1);
    // 1.3.4 (QA D133-2): at most MAX_PHOTOS_PER_MATCH photos per match.
    const inMatch = Object.values(this.db.photos).filter((x) => x.matchId === matchId);
    if (inMatch.length >= MAX_PHOTOS_PER_MATCH) throw new CodedError(PHOTO_ERROR_CODES.limit, 'This match already has the maximum number of photos');
    const photo = await readPhoto(localUri);
    // 1.3.4 (QA D133-3): the same image (sha256 of its bytes) can't be added to a match twice.
    const hash = await blobSha256(photo.blob);
    if (inMatch.some((x) => x.hash === hash)) throw new CodedError(PHOTO_ERROR_CODES.duplicate, 'This photo is already in this match');
    onProgress?.(0.5);
    // A web blob: URL dies with the page: keep small photos as data: URLs so they survive a reload.
    const url = Platform.OS === 'web' && localUri.startsWith('blob:') && photo.size <= 600_000 ? await toDataUrl(photo.blob).catch(() => localUri) : localUri;
    this.db.photos[id] = { id, matchId, url, uploadedBy: by, createdAt: Date.now(), hash };
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
    // 1.3.7 (F135-1): after an admin cleared the flag the status stays 'approved'; the captain's verdict decides.
    // 1.4.6 (QA V145-2): only the verdict of the current re-open epoch counts; a new one carries the epoch
    const prev = currentVerification(m);
    const epoch = m.reopenEpoch ?? 0;
    const captain = status === 'confirmed' ? ('confirmed' as const) : ('rejected' as const);
    const verification =
      prev?.status === 'approved'
        ? { ...prev, captain, by: me, at: Date.now(), epoch, ...(reason ? { reason } : {}) }
        : { status, captain, by: me, at: Date.now(), epoch, ...(reason ? { reason } : {}) };
    // 1.3.9 (V138-11): the confirmation time goes to confirmedAt; the match's own times are never touched
    this.db.matches[matchId] = { ...m, verification, ...(status === 'confirmed' ? { confirmedAt: verification.at } : {}), updatedAt: Date.now() };
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
    // 1.4.5 (QA V144-2): a match stored as finished without a winner can be voided too (no POTM needed)
    const winnerless = m.status === 'finished' && !matchOver({ ...m, status: 'live' });
    if (!isCompleted(m) && !(winnerless && decision === 'void')) throw new CodedError('not_completed', CONFIRM_MESSAGES.not_completed);
    if (v === 'approved' || v === 'voided') throw new CodedError('already_reviewed', CONFIRM_MESSAGES.already_reviewed);
    if (ownMatchReview(m, me)) throw new CodedError(OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE);
    // 1.3.8 (V137-1): keep the captain's verdict explicitly (also one only recorded in the older fields)
    this.db.matches[matchId] = { ...m, verification: { ...(currentVerification(m) ?? { status: 'pending' }), captain: captainVerdict(m), status: decision === 'approve' ? 'approved' : 'voided', reviewedBy: me, reviewedAt: Date.now(), epoch: m.reopenEpoch ?? 0 }, updatedAt: Date.now() };
    this.changed();
  }
  // ---------- 1.3.7 feedback + fact of the day (local) ----------
  async sendFeedback(f: { stars: number; text: string; appVersion?: string }) {
    await this.ready;
    const me = this.authUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    this.requireTerms(); // 1.3.8 (V137-5): like the API and firestore.rules
    const c = checkFeedback(f);
    const list = (this.db.feedback ??= []);
    // same limit as the API: 5 per hour per user
    if (list.filter((x) => x.userId === me && Date.now() - x.createdAt < 3_600_000).length >= 5) throw new CodedError('rate_limited', 'Too many requests. Wait a moment and try again.');
    list.unshift({ id: 'fb_' + uid(), userId: me, userName: this.db.users[me]?.name ?? null, ...c, createdAt: Date.now() });
    this.changed();
  }
  // ---------- 1.4.19 support tickets (local) ----------
  /** 1.4.20: on-device RAG with the mock answer step (services/askLocal). */
  async askVolleyLive(question: string, lang: 'en' | 'hi') {
    return askLocally(this.authUser?.uid, question, lang);
  }
  async createSupportTicket(t: NewSupportTicket) {
    await this.ready;
    const me = this.authUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    this.requireTerms();
    const c = checkSupportTicket(t);
    if (t.screenshot) assertSupportImage(t.screenshot.type, t.screenshot.size);
    const list = (this.db.supportTickets ??= []);
    // 1.4.20 (QA V1419-6): the API's rule (core/support SUPPORT_RATE) and the real wait in seconds
    const wait = supportRateWait(list.filter((x) => x.userId === me).map((x) => x.createdAt), Date.now());
    if (wait) throw Object.assign(new CodedError('rate_limited', 'Too many requests. Wait a moment and try again.'), { retryAfter: wait });
    const now = Date.now();
    const id = 'st_' + uid();
    list.unshift({ id, userId: me, userName: this.db.users[me]?.name ?? null, ...c, status: 'open', screenshotUrl: t.screenshot?.uri ?? null, createdAt: now, updatedAt: now });
    this.changed();
    return id;
  }
  async listMySupportTickets() {
    await this.ready;
    const me = this.authUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    return (this.db.supportTickets ?? []).filter((x) => x.userId === me).map((x) => ({ ...x }));
  }
  async listSupportTickets() {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) throw new CodedError('admin_only', 'Admins only');
    return (this.db.supportTickets ?? []).map((x) => ({ ...x }));
  }
  async setSupportTicketStatus(id: string, status: SupportStatus) {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) throw new CodedError('admin_only', 'Admins only');
    const st = checkSupportStatus(status);
    const x = (this.db.supportTickets ?? []).find((y) => y.id === id);
    if (!x) throw new Error('Ticket not found');
    x.status = st;
    x.updatedAt = Date.now();
    this.changed();
  }
  async listFeedback() {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) throw new CodedError('admin_only', 'Admins only');
    return [...(this.db.feedback ?? [])];
  }
  private get dailyItems(): DailyItem[] {
    return (this.db.dailyItems ??= BUNDLED_DAILY_ITEMS.map((x) => ({ ...x })));
  }
  async listDailyItems(opts?: { all?: boolean }) {
    await this.ready;
    // 1.4.1 (V140-7): admins see everything but deleted tombstones; the public list also carries the items
    // that are off / deleted (only their timestamps), which keep their slots in started rotation cycles.
    return opts?.all
      ? this.dailyItems.filter((x) => !x.deleted).map((x) => ({ ...x }))
      : this.dailyItems.filter((x) => x.active || x.removedAt != null).map((x) => (x.active ? { ...x } : dailyTombstone(x))); // as the API
  }
  async saveDailyItem(item: Partial<DailyItem>) {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) throw new CodedError('admin_only', 'Admins only');
    const c = checkDailyItem(item);
    const i = item.id ? this.dailyItems.findIndex((x) => x.id === item.id && !x.deleted) : -1;
    if (item.id && i < 0) throw new Error('Item not found');
    const now = Date.now();
    // createdAt (phone clock in the demo): a new item leads the next rotation cycle (core/dailyItems.ts pickDaily).
    // 1.4.1 (V140-7): turning an item off stamps removedAt once; turning it back on creates a copy (new id,
    // new createdAt) and leaves the old one as a deleted tombstone, so started cycles never change.
    if (i >= 0) {
      const old = this.dailyItems[i];
      if (!old.active && c.active) {
        this.dailyItems[i] = { ...dailyTombstone(old), deleted: true, removedAt: old.removedAt ?? null }; // pre-1.4.1 off items stay out of the cycles; 1.4.2 (V141-6): no text kept
        const id = 'd_' + uid();
        this.dailyItems.push({ ...c, id, createdAt: now, removedAt: null });
        this.changed();
        return id;
      }
      const removedAt = old.active ? (c.active ? null : now) : old.removedAt ?? null;
      this.dailyItems[i] = { ...c, id: old.id, createdAt: old.createdAt ?? null, removedAt };
      this.changed();
      return old.id;
    }
    const id = 'd_' + uid();
    this.dailyItems.push({ ...c, id, createdAt: now, removedAt: c.active ? null : now });
    this.changed();
    return id;
  }
  async deleteDailyItem(id: string) {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) throw new CodedError('admin_only', 'Admins only');
    // 1.4.1 (V140-7): a tombstone (keeps its slot in the cycles that had started), never listed again
    this.db.dailyItems = this.dailyItems.map((x) => (x.id === id && !x.deleted ? { ...dailyTombstone(x), active: false, deleted: true, removedAt: x.active ? Date.now() : x.removedAt ?? null } : x)); // 1.4.2 (V141-6): no text kept
    this.changed();
  }
  /** 1.3.6: bundled sample only – the demo makes no network calls. */
  async lookupPincode(pin: string) {
    return demoPincodeLookup(pin);
  }
  async listFlagged() {
    await this.ready;
    if (!(await this.isAdmin(this.authUser?.uid ?? ''))) return [];
    // 1.4.5: plus abandoned matches waiting for review, finished without a winner, pending abandon requests
    return Object.values(this.db.matches).filter((m) => needsReview(m) || needsAdminAction(m)).sort((a, b) => (b.finishedAt ?? b.updatedAt ?? 0) - (a.finishedAt ?? a.updatedAt ?? 0));
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
    // 1.4.20 (QA V1419-1): the caller is always the owner – a passed organizerId for someone else is refused
    const me = this.authUser?.uid;
    if (!me || (t0.organizerId != null && t0.organizerId !== me)) throw new CodedError(NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE);
    const id = 'tour_' + uid();
    this.db.tournaments[id] = { ...t, organizerId: me, id, createdAt: Date.now() };
    this.changed();
    return id;
  }
  async updateTournament(id: string, patch: Partial<Tournament>) {
    const t = this.db.tournaments[id];
    if (!t) throw new Error('Tournament not found');
    // 1.4.19: the owner only (core/tournamentAdmin) – also when signed out, and never a change of owner
    guardTournamentEdit(t, this.authUser?.uid, patch);
    const merged = { ...t, ...patch };
    checkTournamentFields({ ...patch, startDate: merged.startDate, endDate: merged.endDate }, { startChanged: patch.startDate !== undefined && patch.startDate !== t.startDate });
    if (patch.teams) {
      const problem = tournamentTeamsProblem(patch.teams, (tid) => this.db.teams[tid]);
      if (problem) throw new Error(problem);
    }
    this.db.tournaments[id] = { ...this.db.tournaments[id], ...patch, id };
    this.changed();
  }
  /** 1.4.19: the owner deletes the tournament (its matches stay, unlinked from nothing – they keep their result). */
  async deleteTournament(id: string) {
    const t = this.db.tournaments[id];
    if (!t) throw new Error('Tournament not found');
    assertTournamentAdmin(t, this.authUser?.uid);
    delete this.db.tournaments[id];
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
    this.qaAdmins.clear();
    await AsyncStorage.removeItem(KEY);
    await AsyncStorage.removeItem(QA_ADMIN_KEY).catch(() => {});
    connectivity.setSimulatedOffline(false);
    await AsyncStorage.removeItem(SIM_OFFLINE_KEY).catch(() => {});
    // 1.4.1 (QA V140-13): the review prompt's 60-day "last asked" is per user on this phone; a demo reset
    // starts over, so it is cleared too (it used to survive and silently block the prompt after a reset)
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(REVIEW_LAST_ASKED_PREFIX));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch {
      // storage unavailable: nothing to clear
    }
    this.changed();
    await this.signOut();
  }
}
