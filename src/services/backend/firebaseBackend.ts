import { checkFeedback } from '../../core/reviewPrompt';
import { checkDailyItem, type DailyItem } from '../../core/dailyItems';
/**
 * Production backend: Firebase Auth (phone), Firestore, Storage.
 *
 * Data model (see firestore.rules):
 *   users/{uid}                    profile
 *   phoneIndex/{e164}              { uid }  – lookup by mobile number (get only, no listing)
 *   teams/{teamId}                 team, memberIds, pendingPhones
 *   matches/{matchId}              match + event log + summary
 *   matches/{matchId}/photos/{id}  photo album
 *   challenges/{id}                team challenges
 *   tournaments/{id}               tournament with fixtures
 *   courts/{id}                    community-added courts
 */
import { checkRegistrationUpdate, fullName, isApsPincode, pincodePrefixOk, sentRegistration } from '../../core/registration';
import { MIN_AGE } from '../config';
import { onAuthStateChanged, signInWithPhoneNumber, signOut as fbSignOut, type ApplicationVerifier } from 'firebase/auth';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import { blobSha256, readPhoto } from '../photoFile';
import { planEventSteps } from '../../core/eventSteps';
import { computeState, summarize, type Side } from '../../core/scoring';
import { POTM_MESSAGES, potmProblem } from '../../core/potm';
import { MIN_RANKED_MATCHES, rankPlayers, rowFor } from '../../core/ranking';
import { CONFIRM_MESSAGES, captainVerdict, confirmProblem, countMatches, countedMatchIdsFor, countedTotals, isCompleted, needsReview, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE, ownMatchReview, playerWallet, verificationStatus } from '../../core/antifraud';
import { guardCreate, guardProgress, guardUpdate } from '../../core/matchGuards';
import { TERMS_VERSION, TERMS_VERSION_MISMATCH, type TermsAcceptance } from '../../core/terms';
import { checkText } from '../../core/validate';
import { canAddMatchPhoto, PHOTO_ERROR_CODES } from '../../core/photos';
import { MAX_PHOTOS_PER_MATCH } from '../../core/limits';
import { CodedError, PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE } from '../../core/codedError';
import type { Challenge, Court, Match, MatchPhoto, Team, Tournament, UserProfile } from '../../core/types';
import { assertRoster, canonicalParticipants, challengeProblem, PARTICIPANTS_MESSAGE, participantsMatchRoster, ROSTER_MESSAGES, tournamentTeamsProblem } from '../../core/roster';
import { getFirebase } from '../firebase';
import { checkChallengeFields, checkCourtFields, checkMatchFields, checkProfileFields, checkTeamFields, checkTournamentFields, ValidationError } from '../../core/validate';
import { INVALID_PHONE_CODE, isValidE164 } from '../../core/phone';
import { IDEMPOTENCY_KEY_RE, inviteState, PHOTO_WRONG_ACCOUNT, type InviteState } from './types';
import type { Backend, FeedbackItem, NewMatch, PhoneVerifier, RankingsResult, ReviewDecision, UploadOptions, UploadProgress, WalletResult } from './types';

const withId = <T>(d: QueryDocumentSnapshot<DocumentData>): T => ({ ...(d.data() as object), id: d.id }) as T;
/** Firestore Timestamp (rules-set server time) -> epoch ms; numbers/null pass through. */
const ms = (v: unknown): number | null =>
  v == null ? null : typeof v === 'number' ? v : typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null;
/** A match document with its server times as epoch ms (core/antifraud.ts works on numbers). */
function matchFrom(data: DocumentData, id: string): Match {
  const v = data.verification as Record<string, unknown> | null | undefined;
  return {
    ...(data as Match),
    id,
    startedServerAt: ms(data.startedServerAt),
    finishedServerAt: ms(data.finishedServerAt),
    verification: v ? ({ ...v, at: ms(v.at), reviewedAt: ms(v.reviewedAt) } as Match['verification']) : null,
  };
}
const matchOf = (d: QueryDocumentSnapshot<DocumentData>): Match => matchFrom(d.data(), d.id);
/**
 * Start times (1.3.0, QA AF-14 / N121-3): firestore.rules require startedServerAt = the request time
 * when a scheduled match goes live (startedAt within 5 min of it) and both cleared when it goes back
 * to scheduled. The device never backdates a start.
 */
function startFields(prev: Match['status'] | undefined, next: Match['status']): Record<string, unknown> {
  if (prev === 'scheduled' && next === 'live') return { startedAt: Date.now(), startedServerAt: serverTimestamp() };
  if (prev === 'live' && next === 'scheduled') return { startedAt: null, startedServerAt: null };
  return {};
}

/** Firestore rejects `undefined`; strip it recursively. */
type LogBase = { events: Match['events']; rules: Match['rules']; firstServe: Side; status?: Match['status'] };
function logOf(m: Match): LogBase {
  return { events: m.events ?? [], rules: m.rules, firstServe: m.firstServe ?? 'A', status: m.status };
}
/**
 * Finish times for a scorer write (retest 1.1.0 NB-R3). firestore.rules only accept them in a write
 * that changes the status: finishedServerAt is the server's request time when the match becomes
 * finished (null otherwise) and finishedAt is the device time, at most 5 min ahead. A write that
 * keeps the status leaves both untouched. The POTM is never written here (it stays locked).
 */
function finishFields(prev: Match['status'] | undefined, next: Match['status']): Record<string, unknown> {
  if (prev === next) return {};
  const done = next === 'finished' || next === 'abandoned';
  return { finishedAt: done ? Date.now() : null, finishedServerAt: next === 'finished' ? serverTimestamp() : null };
}

function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) out[k] = clean(val);
    return out as T;
  }
  return v;
}

/**
 * Photo blob checked on the client (services/photoFile.ts): allow-listed declared type, magic bytes,
 * per-type minimum and 10 MB maximum. Unknown types are refused, never relabelled as JPEG (retest
 * 1.1.0 NB-P3); storage.rules check the type and size again.
 */
const photoBlob = (uri: string) => readPhoto(uri);

const chunk = <T>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class FirebaseBackend implements Backend {
  /** Last known event log per match (snapshots and own writes), for planEventSteps. */
  private lastLog = new Map<string, LogBase>();
  readonly mode = 'firebase' as const;
  private get fb() {
    return getFirebase();
  }

  // ---------- auth ----------
  onAuthChanged(cb: (u: { uid: string; phoneNumber: string | null } | null) => void) {
    return onAuthStateChanged(this.fb.auth, (u) => cb(u ? { uid: u.uid, phoneNumber: u.phoneNumber } : null));
  }
  async sendOtp(phone: string, verifier: PhoneVerifier | null) {
    if (!verifier) throw new Error('reCAPTCHA verifier not ready');
    const confirmation = await signInWithPhoneNumber(this.fb.auth, phone, verifier as unknown as ApplicationVerifier);
    return {
      confirm: async (code: string) => {
        await confirmation.confirm(code);
      },
    };
  }
  async signOut() {
    await fbSignOut(this.fb.auth);
  }

  // ---------- profiles ----------
  watchProfile(uid: string, cb: (p: UserProfile | null) => void) {
    // 1.3.7: your own profile also merges your private registration doc (dob, email, pincode…).
    let pub: UserProfile | null | undefined;
    let priv: Partial<UserProfile> = {};
    const emit = () => pub !== undefined && cb(pub ? { ...pub, ...priv } : null);
    const unPub = onSnapshot(doc(this.fb.db, 'users', uid), (s) => {
      pub = s.exists() ? ({ ...(s.data() as UserProfile), id: s.id }) : null;
      emit();
    });
    const own = this.fb.auth.currentUser?.uid === uid;
    const unPriv = own
      ? onSnapshot(
          doc(this.fb.db, 'users', uid, 'private', 'registration'),
          (s) => {
            const d = (s.exists() ? s.data() : {}) as Record<string, unknown>;
            priv = { dob: d.dob as string | undefined, email: (d.email as string | null) ?? null, pincode: d.pincode as string | undefined, district: (d.district as string | null) ?? null, state: (d.state as string | null) ?? null };
            emit();
          },
          () => {},
        )
      : () => {};
    return () => {
      unPub();
      unPriv();
    };
  }
  async saveProfile(p0: UserProfile) {
    // The Indian format is checked when the number is set or changed (firestore.rules do the same),
    // so a profile from before build 216 can still be saved unchanged (fix-retest N4).
    const cur = await getDoc(doc(this.fb.db, 'users', p0.id));
    const samePhone = cur.exists() && (cur.data() as UserProfile).phone === p0.phone;
    if (!samePhone && !isValidE164(p0.phone)) throw new ValidationError(INVALID_PHONE_CODE, 'phone');
    const batch = writeBatch(this.fb.db);
    // 1.3.7: names on the public profile; dob / email / pincode / district / state in the owner-only doc
    // (firestore.rules users/{uid}/private/registration). A save is checked together with the stored
    // fields (R136-3); the age range only when the DOB is new or changed (R136-8).
    const { dob: _dob, email: _email, pincode: _pin, district: _district, state: _state, ...rest } = p0 as UserProfile;
    let pub: Omit<UserProfile, 'dob' | 'email' | 'pincode' | 'district' | 'state'> = rest;
    if (sentRegistration(p0)) {
      const curPub = cur.exists() ? (cur.data() as UserProfile) : null;
      const priv = await getDoc(doc(this.fb.db, 'users', p0.id, 'private', 'registration')).catch(() => null);
      const stored = { firstName: curPub?.firstName ?? null, lastName: curPub?.lastName ?? null, ...(priv?.exists() ? (priv.data() as { dob?: string; email?: string | null; pincode?: string }) : {}) };
      const f = checkRegistrationUpdate(p0, stored, MIN_AGE);
      // 1.3.8 (V137-5): same as the API without a lookup – an unallocated prefix is refused, and no
      // client-typed district/state is stored (firestore.rules registrationOk refuses both)
      if (!pincodePrefixOk(f.pincode) && !isApsPincode(f.pincode)) throw Object.assign(new CodedError('pincode_unknown', 'No post office has this pincode'), { field: 'pincode' });
      pub = { ...pub, firstName: f.firstName, lastName: f.lastName, name: fullName(f.firstName, f.lastName) };
      batch.set(doc(this.fb.db, 'users', p0.id, 'private', 'registration'), clean({ dob: f.dob, email: f.email, pincode: f.pincode, updatedAt: serverTimestamp() }));
    }
    const p = checkProfileFields(pub as UserProfile);
    batch.set(doc(this.fb.db, 'users', p.id), clean(p), { merge: true });
    batch.set(doc(this.fb.db, 'phoneIndex', p.phone), { uid: p.id });
    await batch.commit();
  }
  async getProfiles(uids: string[]) {
    const ids = [...new Set(uids)].filter(Boolean);
    const out: UserProfile[] = [];
    for (const part of chunk(ids, 30)) {
      const snap = await getDocs(query(collection(this.fb.db, 'users'), where(documentId(), 'in', part)));
      snap.forEach((d) => out.push(withId<UserProfile>(d)));
    }
    return out;
  }
  async findUserByPhone(phone: string) {
    const idx = await getDoc(doc(this.fb.db, 'phoneIndex', phone));
    if (!idx.exists()) return null;
    const uid = (idx.data() as { uid: string }).uid;
    const u = await getDoc(doc(this.fb.db, 'users', uid));
    return u.exists() ? ({ ...(u.data() as UserProfile), id: u.id }) : null;
  }
  async uploadAvatar(uid: string, localUri: string) {
    const { blob, type, ext } = await photoBlob(localUri);
    const r = ref(this.fb.storage, `avatars/${uid}/${Date.now()}.${ext}`);
    await uploadBytes(r, blob, { contentType: type });
    return await getDownloadURL(r);
  }
  async savePushToken(uid: string, token: string) {
    // Stored separately so other users can't read your push token (see firestore.rules).
    await setDoc(doc(this.fb.db, 'pushTokens', uid), { token, updatedAt: Date.now() });
  }

  // ---------- teams ----------
  async createTeam(t0: Omit<Team, 'id' | 'nameLower' | 'createdAt'>) {
    const t = checkTeamFields(t0);
    const r = await addDoc(collection(this.fb.db, 'teams'), clean({ ...t, nameLower: t.name.toLowerCase(), createdAt: Date.now() }));
    return r.id;
  }
  async updateTeam(id: string, patch: Partial<Team>) {
    const p = checkTeamFields({ ...patch }) as Partial<Team>;
    delete p.id;
    if (p.name) p.nameLower = p.name.toLowerCase();
    await updateDoc(doc(this.fb.db, 'teams', id), clean(p) as DocumentData);
  }
  watchTeam(id: string, cb: (t: Team | null) => void) {
    return onSnapshot(doc(this.fb.db, 'teams', id), (s) => cb(s.exists() ? ({ ...(s.data() as Team), id: s.id }) : null));
  }
  watchMyTeams(uid: string, cb: (t: Team[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'teams'), where('memberIds', 'array-contains', uid)), (s) =>
      cb(s.docs.map((d) => withId<Team>(d))),
    );
  }
  watchTeamInvites(phone: string, cb: (t: Team[]) => void, onState?: (s: InviteState) => void) {
    onState?.(inviteState(phone));
    if (inviteState(phone) !== 'ok') {
      cb([]);
      return () => {};
    }
    return onSnapshot(query(collection(this.fb.db, 'teams'), where('pendingPhones', 'array-contains', phone)), (s) =>
      cb(s.docs.map((d) => withId<Team>(d))),
    );
  }
  async acceptTeamInvite(teamId: string, uid: string, phone: string) {
    await updateDoc(doc(this.fb.db, 'teams', teamId), { memberIds: arrayUnion(uid), pendingPhones: arrayRemove(phone) });
  }
  async declineTeamInvite(teamId: string, phone: string) {
    await updateDoc(doc(this.fb.db, 'teams', teamId), { pendingPhones: arrayRemove(phone) });
  }
  async searchTeams(prefix: string) {
    const p = prefix.trim().toLowerCase();
    const q = p
      ? query(collection(this.fb.db, 'teams'), where('nameLower', '>=', p), where('nameLower', '<=', p + '\uf8ff'), limit(20))
      : query(collection(this.fb.db, 'teams'), orderBy('createdAt', 'desc'), limit(20));
    const s = await getDocs(q);
    return s.docs.map((d) => withId<Team>(d));
  }

  // ---------- validation the rules can only partly do (10 reads per request) ----------
  /**
   * Every player must have a users/{id} profile. firestore.rules check team sides against the
   * team's members and the first 4 players of a by-number side; this checks everyone.
   */
  private async assertPlayersRegistered(m: Pick<Match, 'teamA' | 'teamB'>) {
    const ids = [...m.teamA.players, ...m.teamB.players].map((p) => p.id);
    const found = new Set((await this.getProfiles(ids)).map((u) => u.id));
    if (ids.some((id) => !found.has(id))) throw new Error(ROSTER_MESSAGES.notUser);
  }
  private async getTeams(ids: string[]) {
    const out = new Map<string, Team>();
    for (const part of chunk([...new Set(ids)], 30)) {
      const snap = await getDocs(query(collection(this.fb.db, 'teams'), where(documentId(), 'in', part)));
      snap.forEach((d) => out.set(d.id, withId<Team>(d)));
    }
    return out;
  }
  /** Tournament teams: registered, able to play (the rules check the first 10, this checks all). */
  private async assertTournamentTeams(teams: Tournament['teams']) {
    const found = await this.getTeams(teams.map((t) => t.id));
    const problem = tournamentTeamsProblem(teams, (id) => found.get(id));
    if (problem) throw new Error(problem);
  }
  private async checkMatch(m: Pick<Match, 'teamA' | 'teamB' | 'status' | 'events' | 'participantIds' | 'createdBy' | 'scorerId'>) {
    assertRoster(m, m.status === 'live' || m.events.length > 0);
    if (!participantsMatchRoster(m)) throw new Error(PARTICIPANTS_MESSAGE);
    await this.assertPlayersRegistered(m);
  }

  // ---------- matches ----------
  async createMatch(m: NewMatch) {
    // firestore.rules enforce the same roster rules; checking here gives a clear message first
    // and covers what the rules' read budget can't (every player's profile).
    // firestore.rules compare participantIds position by position (team A, team B, creator/scorer).
    // 1.3.0: scheduled/live only, captains (a registered team's captain / a player of a built side),
    // no POTM, finish or server fields (core/matchGuards.ts; firestore.rules matchCreateOk).
    const { startedAt: _s, startedServerAt: _ss, finishedServerAt: _fs, verification: _v, ...rest } = m;
    const teams = await this.getTeams([m.teamA.teamId, m.teamB.teamId].filter((x): x is string => !!x));
    const cap = (t: Match['teamA']) => (t.teamId ? teams.get(t.teamId)?.captainId ?? null : null);
    guardCreate(rest, { A: cap(m.teamA), B: cap(m.teamB) });
    const doc0 = checkMatchFields({ ...rest, participantIds: canonicalParticipants(m) }, { scheduleChanged: true });
    await this.checkMatch(doc0);
    const now = Date.now();
    const live = doc0.status === 'live' ? { startedAt: now, startedServerAt: serverTimestamp() } : {};
    const r = await addDoc(collection(this.fb.db, 'matches'), clean({ ...doc0, ...live, createdAt: now, updatedAt: now }));
    return r.id;
  }
  watchMatch(id: string, cb: (m: Match | null) => void) {
    // includeMetadataChanges lets the scorer see pending (offline) writes immediately
    return onSnapshot(doc(this.fb.db, 'matches', id), { includeMetadataChanges: false }, (s) => {
      const m = s.exists() ? matchFrom(s.data(), s.id) : null;
      if (m) this.lastLog.set(id, logOf(m));
      cb(m);
    });
  }
  async saveMatchProgress(id: string, p: { events: Match['events']; summary: Match['summary']; status: Match['status']; startedAt?: number | null; finishedAt?: number | null }) {
    // Not awaited by callers when offline: Firestore queues the write and syncs later.
    checkMatchFields({ events: p.events });
    const ref = doc(this.fb.db, 'matches', id);
    // The rules accept one scorer step per write (append 1-3, undo 1, re-credit one of the last 3:
    // src/core/eventSteps.ts). A bigger jump (e.g. a log restored after a long time offline) is
    // written as a sequence of steps, each with its own summary. Writes are queued in order, so they
    // are started together and awaited at the end (offline they resolve only once synced).
    let base = this.lastLog.get(id);
    if (!base) {
      try {
        const cur = await getDoc(ref);
        if (cur.exists()) {
          const cm = matchFrom(cur.data(), id);
          // 1.3.0: closed after the POTM / abandon, one-way statuses (the rules refuse it anyway)
          guardProgress(cm, p.status);
          base = logOf(cm);
        }
      } catch {
        // no cached copy: write directly; the rules decide
      }
    }
    const writes: Promise<void>[] = [];
    let prev = base?.status;
    // times are never the device's guess: start/finish fields come from the status change only
    const { finishedAt: _f, startedAt: _st, ...rest } = p;
    if (base) {
      const steps = planEventSteps(base.events, p.events);
      for (const ev of steps.slice(0, -1)) {
        const st = computeState(base.rules, ev, base.firstServe);
        const status: Match['status'] = st.finished ? 'finished' : p.status === 'finished' ? 'live' : p.status;
        writes.push(updateDoc(ref, clean({
          events: ev,
          summary: summarize(st),
          status,
          ...startFields(prev, status),
          ...finishFields(prev, status),
          updatedAt: Date.now(),
          serverUpdatedAt: serverTimestamp(),
        }) as DocumentData));
        prev = status;
      }
      this.lastLog.set(id, { ...base, events: p.events, status: p.status });
    }
    // Unknown stored status (no cache): only a finishing write carries the finish times.
    const times = prev === undefined ? (p.status === 'finished' ? finishFields(undefined, 'finished') : {}) : { ...startFields(prev, p.status), ...finishFields(prev, p.status) };
    writes.push(updateDoc(ref, clean({ ...rest, ...times, updatedAt: Date.now(), serverUpdatedAt: serverTimestamp() }) as DocumentData));
    await Promise.all(writes);
  }
  async updateMatch(id: string, patch: Partial<Match>) {
    const cur = await getDoc(doc(this.fb.db, 'matches', id));
    if (!cur.exists()) throw new Error('Match not found');
    const before = matchFrom(cur.data(), id);
    // 1.3.0 (QA N121-1/N121-3, INFO): no client times, one-way statuses, closed when terminal.
    guardUpdate(before, patch);
    const p = checkMatchFields({ ...patch }, { scheduleChanged: patch.scheduledAt != null }) as Partial<Match>;
    delete p.id;
    if (p.teamA || p.teamB || p.participantIds) {
      const merged = { ...before, ...p };
      // Always write the canonical order the rules check (a roster edit can reorder players).
      p.participantIds = canonicalParticipants(merged);
      await this.checkMatch({ ...merged, participantIds: p.participantIds });
    }
    const ref0 = doc(this.fb.db, 'matches', id);
    const { status, ...meta } = p;
    const statusChange = status && status !== before.status;
    // A roster change and going live are two writes (each within the rules' expression budget).
    if (statusChange && Object.keys(meta).length) await updateDoc(ref0, clean({ ...meta, updatedAt: Date.now() }) as DocumentData);
    const body = statusChange
      ? { status, ...startFields(before.status, status!), ...finishFields(before.status, status!) }
      : meta;
    await updateDoc(ref0, clean({ ...body, updatedAt: Date.now() }) as DocumentData);
  }
  watchLiveMatches(cb: (m: Match[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches'), where('status', 'in', ['live', 'scheduled']), limit(50)), (s) =>
      cb(s.docs.map((d) => matchOf(d)).sort((a, b) => b.updatedAt - a.updatedAt)),
    );
  }
  watchMyMatches(uid: string, cb: (m: Match[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches'), where('participantIds', 'array-contains', uid), limit(200)), (s) =>
      cb(s.docs.map((d) => matchOf(d)).sort((a, b) => b.updatedAt - a.updatedAt)),
    );
  }
  watchTournamentMatches(tid: string, cb: (m: Match[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches'), where('tournamentId', '==', tid)), (s) =>
      cb(s.docs.map((d) => matchOf(d))),
    );
  }
  async listPublicMatches() {
    const s = await getDocs(query(collection(this.fb.db, 'matches'), where('status', 'in', ['live', 'scheduled']), limit(200)));
    return s.docs.map((d) => matchOf(d)).filter((m) => !!m.location);
  }

  // ---------- photos ----------
  watchPhotos(matchId: string, cb: (p: MatchPhoto[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches', matchId, 'photos'), orderBy('createdAt', 'desc')), (s) =>
      cb(s.docs.map((d) => withId<MatchPhoto>(d))),
    );
  }
  /**
   * Retest 1.1.0 NB-P2: the queue item id is the idempotency key. It names both the Storage object
   * (matches/<match>/<uid>/<key>.<ext>) and the photo document (photos/<key>), so a retry
   *  - finds the document already written and stops (no duplicate), or
   *  - finds the file uploaded by the failed attempt and only writes the document (no re-upload, no
   *    orphaned file; storage.rules refuse overwriting it anyway).
   */
  async uploadMatchPhoto(matchId: string, uid: string, localUri: string, onProgress?: UploadProgress, opts?: UploadOptions) {
    const me = this.fb.auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    if (me !== uid) throw new CodedError(PHOTO_WRONG_ACCOUNT, 'This photo was added by another account');
    // Same check as firestore.rules / storage.rules (players + scorer), so a refusal is a clear message.
    const snap = await getDoc(doc(this.fb.db, 'matches', matchId));
    if (!snap.exists()) throw new Error('Match not found');
    if (!canAddMatchPhoto(snap.data() as Match, uid)) throw new CodedError(PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE);
    const key =
      opts?.idempotencyKey && IDEMPOTENCY_KEY_RE.test(opts.idempotencyKey) ? opts.idempotencyKey : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const { blob, type, ext } = await photoBlob(localUri);
    // 1.3.5 (QA Firebase residuals): the photo's document id is its sha256, and every create moves
    // the match's photo counter (photoMeta/count) by one in the same transaction, so firestore.rules
    // refuse a second copy and a 51st photo themselves (not only this client check).
    const hash = await blobSha256(blob);
    const photoRef = doc(this.fb.db, 'matches', matchId, 'photos', hash);
    const counterRef = doc(this.fb.db, 'matches', matchId, 'photoMeta', 'count');
    const existing = await getDoc(photoRef);
    if (existing.exists()) {
      const d = existing.data() as { uploadedBy?: string; key?: string };
      if (d.uploadedBy === uid && d.key === key) return void onProgress?.(1); // a retry that already landed
      throw new CodedError(PHOTO_ERROR_CODES.duplicate, 'This photo is already in this match');
    }
    const c0 = await getDoc(counterRef);
    if (((c0.exists() ? (c0.data() as { n?: number }).n : 0) ?? 0) >= MAX_PHOTOS_PER_MATCH)
      throw new CodedError(PHOTO_ERROR_CODES.limit, `This match already has ${MAX_PHOTOS_PER_MATCH} photos`);
    const path = `matches/${matchId}/${uid}/${key}.${ext}`;
    const r = ref(this.fb.storage, path);
    let url = await getDownloadURL(r).catch(() => null); // uploaded by an earlier attempt?
    if (!url) {
      const task = uploadBytesResumable(r, blob, { contentType: type });
      if (onProgress) task.on('state_changed', (x) => x.totalBytes > 0 && onProgress(x.bytesTransferred / x.totalBytes));
      await task;
      url = await getDownloadURL(r);
    } else onProgress?.(1);
    const fileUrl = url;
    try {
      await runTransaction(this.fb.db, async (tx) => {
        const [p, c] = [await tx.get(photoRef), await tx.get(counterRef)];
        if (p.exists()) {
          const d = p.data() as { uploadedBy?: string; key?: string };
          if (d.uploadedBy === uid && d.key === key) return;
          throw new CodedError(PHOTO_ERROR_CODES.duplicate, 'This photo is already in this match');
        }
        const n = ((c.exists() ? (c.data() as { n?: number }).n : 0) ?? 0) + 1;
        if (n > MAX_PHOTOS_PER_MATCH) throw new CodedError(PHOTO_ERROR_CODES.limit, `This match already has ${MAX_PHOTOS_PER_MATCH} photos`);
        tx.set(photoRef, { matchId, url: fileUrl, storagePath: path, uploadedBy: uid, createdAt: Date.now(), hash, key });
        tx.set(counterRef, { n, last: hash });
      });
    } catch (e) {
      // refused (duplicate / full): the uploaded file is not used by any photo, remove it (best effort)
      if ((e as { code?: string }).code === PHOTO_ERROR_CODES.duplicate || (e as { code?: string }).code === PHOTO_ERROR_CODES.limit) await deleteObject(r).catch(() => {});
      throw e;
    }
  }
  async deleteMatchPhoto(photo: MatchPhoto) {
    // The document first (rules: uploader only); the file is best effort afterwards. A 1.3.5 photo
    // (id = its hash) gives its slot back in the same transaction (firestore.rules photoMeta).
    const photoRef = doc(this.fb.db, 'matches', photo.matchId, 'photos', photo.id);
    if (photo.hash && photo.id === photo.hash) {
      const counterRef = doc(this.fb.db, 'matches', photo.matchId, 'photoMeta', 'count');
      await runTransaction(this.fb.db, async (tx) => {
        const c = await tx.get(counterRef);
        const n = Math.max(0, ((c.exists() ? (c.data() as { n?: number }).n : 1) ?? 1) - 1);
        tx.delete(photoRef);
        tx.set(counterRef, { n, last: photo.id });
      });
    } else await deleteDoc(photoRef);
    if (photo.storagePath) await deleteObject(ref(this.fb.storage, photo.storagePath)).catch(() => {});
  }

  async listMemories(uid: string) {
    // Matches this user played in (participantIds also lists creators/scorers: keep players only),
    // then the photos of the 20 most recent ones.
    const ms = await getDocs(query(collection(this.fb.db, 'matches'), where('participantIds', 'array-contains', uid), limit(100)));
    const played = ms.docs
      .map((d) => matchOf(d))
      .filter((m) => [...m.teamA.players, ...m.teamB.players].some((p) => p.id === uid))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
    const lists = await Promise.all(
      played.map((m) => getDocs(query(collection(this.fb.db, 'matches', m.id, 'photos'), orderBy('createdAt', 'desc'), limit(20)))),
    );
    return lists
      .flatMap((l) => l.docs.map((d) => withId<MatchPhoto>(d)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60);
  }

  // ---------- Player of the Match / rankings ----------
  async setPlayerOfMatch(matchId: string, playerId: string) {
    const snap = await getDoc(doc(this.fb.db, 'matches', matchId));
    if (!snap.exists()) throw new Error('Match not found');
    const data = snap.data() as Match & { finishedServerAt?: { toMillis(): number } | null };
    // The rules time the 24 h window from finishedServerAt (server time) when the match has it.
    const finishedAt = data.finishedServerAt?.toMillis?.() ?? data.finishedAt;
    const problem = potmProblem({ ...data, finishedAt }, this.fb.auth.currentUser?.uid, playerId);
    if (problem) throw new CodedError(problem, POTM_MESSAGES[problem]);
    await updateDoc(doc(this.fb.db, 'matches', matchId), { playerOfMatchId: playerId, updatedAt: Date.now() });
  }
  /**
   * Same pure ranking as the server (src/core/ranking.ts) over the finished matches. Firestore has no
   * aggregation over the event logs, so the client reads them: capped at the 500 most recently
   * finished matches (documented limit of Firebase mode; the API server ranks every match in SQL).
   */
  async getRankings(uid: string): Promise<RankingsResult> {
    const all = await this.countableMatches();
    const totals = countedTotals(all);
    const r = rankPlayers(totals);
    const myCountedMatchIds = countedMatchIdsFor(countMatches(all).counted, uid);
    return { ranked: r.ranked.slice(0, 100), total: r.total, minMatches: MIN_RANKED_MATCHES, me: rowFor(r, uid, totals.find((x) => x.playerId === uid)), myCountedMatchIds };
  }
  /**
   * The finished matches anti-fraud counts over (src/core/antifraud.ts), newest first by SERVER time:
   * finishedServerAt (set by the rules on the finishing write; QA NB-R4 / N121-6). Matches from before
   * 1.2.1 have no server finish time; they never count unless an admin approved them, so the second
   * query reads approved matches ordered by the rules-set review time. No device time orders anything.
   * Capped at 500 + 200 documents (documented limit of Firebase mode; the API server counts in SQL).
   */
  private async countableMatches(extra: Match[] = []): Promise<Match[]> {
    const col = collection(this.fb.db, 'matches');
    const [byServer, approved] = await Promise.all([
      getDocs(query(col, where('status', '==', 'finished'), orderBy('finishedServerAt', 'desc'), limit(500))),
      getDocs(query(col, where('verification.status', '==', 'approved'), orderBy('verification.reviewedAt', 'desc'), limit(200))).catch(() => null),
    ]);
    const seen = new Map<string, Match>();
    for (const d of [...byServer.docs, ...(approved?.docs ?? [])]) if (!seen.has(d.id)) seen.set(d.id, matchOf(d));
    for (const m of extra) if (!seen.has(m.id) && m.status === 'finished') seen.set(m.id, m);
    return [...seen.values()];
  }
  async getWallet(uid: string): Promise<WalletResult> {
    const mine = await getDocs(query(collection(this.fb.db, 'matches'), where('participantIds', 'array-contains', uid), limit(200)));
    return playerWallet(await this.countableMatches(mine.docs.map(matchOf)), uid);
  }

  // ---------- T&C, confirmation, admin review (1.3.0) ----------
  async getTerms(uid: string) {
    const s = await getDoc(doc(this.fb.db, 'terms', uid));
    if (!s.exists()) return null;
    const d = s.data();
    return { version: String(d.version), acceptedAt: ms(d.acceptedAt) ?? 0 } as TermsAcceptance;
  }
  async acceptTerms(uid: string, version: string) {
    if (version !== TERMS_VERSION) throw new CodedError(TERMS_VERSION_MISMATCH, 'These Terms & Conditions are out of date. Reload and try again.');
    // firestore.rules: own doc, exact version, acceptedAt = server time, forward only
    if ((await this.getTerms(uid))?.version === version) return;
    await setDoc(doc(this.fb.db, 'terms', uid), { version, acceptedAt: serverTimestamp() });
  }
  async isAdmin(_uid: string) {
    // The operator sets the `admin` custom claim (Admin SDK) for the ADMIN_UIDS; the app never does.
    const u = this.fb.auth.currentUser;
    if (!u) return false;
    const t = await u.getIdTokenResult();
    return t.claims.admin === true;
  }
  private async verify(matchId: string, status: 'confirmed' | 'disputed', reason?: string) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const s = await getDoc(doc(this.fb.db, 'matches', matchId));
    if (!s.exists()) throw new Error('Match not found');
    const problem = confirmProblem(matchFrom(s.data(), matchId), me);
    if (problem) throw new CodedError(problem, CONFIRM_MESSAGES[problem]);
    // 1.3.7 (F135-1): keep the captain's verdict; after an admin cleared the flag the status stays 'approved'.
    const old = (s.data().verification ?? {}) as Record<string, unknown>;
    const captain = status === 'confirmed' ? 'confirmed' : 'rejected';
    await updateDoc(doc(this.fb.db, 'matches', matchId), {
      verification:
        old.status === 'approved'
          ? clean({ status: 'approved', captain, by: me, at: serverTimestamp(), reason: reason || undefined, reviewedBy: old.reviewedBy, reviewedAt: old.reviewedAt })
          : clean({ status, captain, by: me, at: serverTimestamp(), reason: reason || undefined }),
      updatedAt: Date.now(),
    });
  }
  confirmResult(matchId: string) {
    return this.verify(matchId, 'confirmed');
  }
  rejectResult(matchId: string, reason: string) {
    return this.verify(matchId, 'disputed', checkText('reason', reason ?? '', 'rejectReason'));
  }
  async reviewMatch(matchId: string, decision: ReviewDecision) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    if (!(await this.isAdmin(me))) throw new CodedError('admin_only', 'Only an admin can review a match');
    const s = await getDoc(doc(this.fb.db, 'matches', matchId));
    if (!s.exists()) throw new Error('Match not found');
    const m = matchFrom(s.data(), matchId);
    if (!isCompleted(m)) throw new CodedError('not_completed', CONFIRM_MESSAGES.not_completed);
    const v = verificationStatus(m);
    if (v === 'approved' || v === 'voided') throw new CodedError('already_reviewed', CONFIRM_MESSAGES.already_reviewed);
    if (ownMatchReview(m, me)) throw new CodedError(OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE);
    const old = (s.data().verification ?? {}) as Record<string, unknown>;
    await updateDoc(doc(this.fb.db, 'matches', matchId), {
      // 1.3.8 (V137-1): the captain's verdict is written explicitly, also when it was only in the older
      // fields (a 1.3.6 client confirmed without `captain`); firestore.rules reviewOk accepts exactly that.
      verification: clean({ by: old.by, at: old.at, reason: old.reason, captain: captainVerdict(m) ?? undefined, status: decision === 'approve' ? 'approved' : 'voided', reviewedBy: me, reviewedAt: serverTimestamp() }),
      updatedAt: Date.now(),
    });
  }
  // ---------- 1.3.7 feedback + fact of the day (firestore.rules: feedback create-own, admin read; dailyItems public read, admin write) ----------
  async sendFeedback(f: { stars: number; text: string; appVersion?: string }) {
    const me = this.fb.auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    const c = checkFeedback(f);
    await addDoc(collection(this.fb.db, 'feedback'), { userId: me, stars: c.stars, text: c.text, appVersion: f.appVersion ?? null, createdAt: serverTimestamp() });
  }
  async listFeedback() {
    const snap = await getDocs(query(collection(this.fb.db, 'feedback'), orderBy('createdAt', 'desc'), limit(200)));
    const out: FeedbackItem[] = [];
    snap.forEach((d) => {
      const x = d.data() as { userId: string; stars: number; text: string; appVersion?: string | null; createdAt?: { toMillis?: () => number } };
      out.push({ id: d.id, userId: x.userId, stars: x.stars, text: x.text, appVersion: x.appVersion ?? null, createdAt: x.createdAt?.toMillis?.() ?? 0 });
    });
    return out;
  }
  async listDailyItems(opts?: { all?: boolean }) {
    const snap = await getDocs(collection(this.fb.db, 'dailyItems'));
    const out: DailyItem[] = [];
    snap.forEach((d) => out.push({ ...(d.data() as Omit<DailyItem, 'id'>), id: d.id }));
    return opts?.all ? out : out.filter((x) => x.active !== false);
  }
  async saveDailyItem(item: Partial<DailyItem>) {
    const c = checkDailyItem(item);
    const ref = item.id ? doc(this.fb.db, 'dailyItems', item.id) : doc(collection(this.fb.db, 'dailyItems'));
    await setDoc(ref, clean({ ...c, updatedAt: serverTimestamp() }));
    return ref.id;
  }
  async deleteDailyItem(id: string) {
    await deleteDoc(doc(this.fb.db, 'dailyItems', id));
  }
  async listFlagged() {
    if (!(await this.isAdmin(this.fb.auth.currentUser?.uid ?? ''))) return [];
    return (await this.countableMatches()).filter(needsReview);
  }

  // ---------- challenges ----------
  async createChallenge(c0: Omit<Challenge, 'id' | 'createdAt' | 'status' | 'matchId'>) {
    const teams = await this.getTeams([c0.fromTeamId, c0.toTeamId]);
    const problem = challengeProblem(c0, teams.get(c0.fromTeamId), teams.get(c0.toTeamId), this.fb.auth.currentUser?.uid ?? null);
    if (problem) throw new Error(problem);
    // Names are copied from the team documents (firestore.rules compare them with get(), QA G19).
    const c = { ...checkChallengeFields(c0), fromTeamName: teams.get(c0.fromTeamId)!.name, toTeamName: teams.get(c0.toTeamId)!.name };
    const r = await addDoc(collection(this.fb.db, 'challenges'), clean({ ...c, status: 'pending', matchId: null, createdAt: Date.now() }));
    return r.id;
  }
  watchChallenges(teamIds: string[], cb: (c: Challenge[]) => void) {
    if (!teamIds.length) {
      cb([]);
      return () => {};
    }
    const ids = teamIds.slice(0, 15);
    const results: { from: Challenge[]; to: Challenge[] } = { from: [], to: [] };
    const emit = () => {
      const map = new Map<string, Challenge>();
      [...results.from, ...results.to].forEach((c) => map.set(c.id, c));
      cb([...map.values()].sort((a, b) => b.createdAt - a.createdAt));
    };
    const u1 = onSnapshot(query(collection(this.fb.db, 'challenges'), where('fromTeamId', 'in', ids)), (s) => {
      results.from = s.docs.map((d) => withId<Challenge>(d));
      emit();
    });
    const u2 = onSnapshot(query(collection(this.fb.db, 'challenges'), where('toTeamId', 'in', ids)), (s) => {
      results.to = s.docs.map((d) => withId<Challenge>(d));
      emit();
    });
    return () => {
      u1();
      u2();
    };
  }
  async respondToChallenge(c: Challenge, status: Challenge['status'], matchId?: string) {
    await updateDoc(doc(this.fb.db, 'challenges', c.id), clean({ status, matchId: matchId ?? null }) as DocumentData);
  }

  // ---------- tournaments ----------
  async createTournament(t0: Omit<Tournament, 'id' | 'createdAt'>) {
    const t = checkTournamentFields(t0, { startChanged: true });
    await this.assertTournamentTeams(t.teams);
    const r = await addDoc(collection(this.fb.db, 'tournaments'), clean({ ...t, createdAt: Date.now() }));
    return r.id;
  }
  async updateTournament(id: string, patch: Partial<Tournament>) {
    const p = checkTournamentFields({ ...patch }, { startChanged: patch.startDate !== undefined }) as Partial<Tournament>;
    delete p.id;
    if (p.teams) await this.assertTournamentTeams(p.teams);
    await updateDoc(doc(this.fb.db, 'tournaments', id), clean(p) as DocumentData);
  }
  watchTournament(id: string, cb: (t: Tournament | null) => void) {
    return onSnapshot(doc(this.fb.db, 'tournaments', id), (s) => cb(s.exists() ? ({ ...(s.data() as Tournament), id: s.id }) : null));
  }
  watchTournaments(cb: (t: Tournament[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'tournaments'), orderBy('startDate', 'desc'), limit(50)), (s) =>
      cb(s.docs.map((d) => withId<Tournament>(d))),
    );
  }

  // ---------- courts ----------
  async addCourt(c0: Omit<Court, 'id' | 'createdAt'>) {
    const c = checkCourtFields(c0);
    const r = await addDoc(collection(this.fb.db, 'courts'), clean({ ...c, createdAt: Date.now() }));
    return r.id;
  }
  async listCourts() {
    const s = await getDocs(query(collection(this.fb.db, 'courts'), limit(300)));
    return s.docs.map((d) => withId<Court>(d));
  }
}
