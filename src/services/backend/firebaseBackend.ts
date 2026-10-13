import { assertSupportImage, checkSupportStatus, checkSupportTicket, SUPPORT_IMAGE_TYPES, type NewSupportTicket, type SupportStatus, type SupportTicket } from '../../core/support';
import { checkFeedback } from '../../core/reviewPrompt';
import { checkDailyItem, dailyTombstone, type DailyItem } from '../../core/dailyItems';
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
import { checkRegistrationUpdate, emailClaimId, emailKey, fullName, isApsPincode, pincodePrefixOk, sentRegistration } from '../../core/registration';
import { MIN_AGE } from '../config';
import { onAuthStateChanged, signInWithPhoneNumber, signOut as fbSignOut, type ApplicationVerifier } from 'firebase/auth';
import { deleteField,
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
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { assertTournamentAdmin, guardTournamentEdit } from '../../core/tournamentAdmin';
import { deleteObject, getDownloadURL, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import { blobSha256, readPhoto } from '../photoFile';
import { planEventSteps } from '../../core/eventSteps';
import { computeState, summarize, type Side } from '../../core/scoring';
import { POTM_MESSAGES, potmProblem } from '../../core/potm';
import { MIN_RANKED_MATCHES, rankPlayers, rowFor } from '../../core/ranking';
import { CONFIRM_MESSAGES, byMatchDateDesc, captainVerdict, confirmedAtOf, confirmProblem, countMatches, countedMatchIdsFor, countedTotals, isCompleted, needsReview, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE, ownMatchReview, playerWallet, verificationStatus } from '../../core/antifraud';
import { finishedScoreProblem, firebaseUpdateProblem, GUARD_MESSAGES, guardCreate, guardProgress, guardUpdate, MATCH_STATUS_MOVE, matchOver } from '../../core/matchGuards';
import { answerAbandon, needsAdminAction, nextMaxEvents, planAbandon, reportAbandon, resolvePatch, type AbandonAnswer, type ResolveAction } from '../../core/abandon';
import { HANDOVER_MESSAGES, handoverProblem, reassignProblem, reassignRecord } from '../../core/scorerHandoff';
import { TERMS_VERSION, TERMS_VERSION_MISMATCH, type TermsAcceptance } from '../../core/terms';
import { checkText } from '../../core/validate';
import { canAddMatchPhoto, PHOTO_ERROR_CODES } from '../../core/photos';
import { MAX_PHOTOS_PER_MATCH } from '../../core/limits';
import { CodedError, PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE } from '../../core/codedError';
import type { Challenge, Court, Match, MatchPhoto, Team, Tournament, UserProfile } from '../../core/types';
import { assertRoster, canonicalParticipants, challengeProblem, PARTICIPANTS_MESSAGE, participantsMatchRoster, ROSTER_MESSAGES, tournamentTeamsProblem } from '../../core/roster';
import { getFirebase } from '../firebase';
import { repairPatch, type RepairFix } from '../../core/verdictRepair';
import { abandonDoc, repairDoc, reassignDoc, reportDoc, resolveDoc, reviewDoc, verifyDoc, type FxSentinels } from './firebaseActionDocs';
import { clean, matchCreateBase, matchCreateChecked, matchCreateDoc, replayMatchData } from './firebaseMatchDoc';
import { checkChallengeFields, checkCourtFields, checkMatchFields, checkProfileFields, checkTeamFields, checkTournamentFields, ValidationError } from '../../core/validate';
import { INVALID_PHONE_CODE, isValidE164 } from '../../core/phone';
import { IDEMPOTENCY_KEY_RE, inviteState, PHOTO_WRONG_ACCOUNT, type InviteState } from './types';
import type { Backend, FeedbackItem, NewMatch, PhoneVerifier, RankingsResult, ReviewDecision, UploadOptions, UploadProgress, WalletResult } from './types';

/** 1.4.2 (QA V141-6): what a deleted daily item keeps of its text (firestore.rules tombstoneOk). */
const fx = (): FxSentinels => ({ stamp: serverTimestamp(), del: deleteField() });
const tombstoneBlank = () => ({ textEn: '', textHi: '', attribution: deleteField(), sourceUrl: deleteField() });

const withId = <T>(d: QueryDocumentSnapshot<DocumentData>): T => ({ ...(d.data() as object), id: d.id }) as T;
/** Firestore Timestamp (rules-set server time) -> epoch ms; numbers/null pass through. */
const ms = (v: unknown): number | null =>
  v == null ? null : typeof v === 'number' ? v : typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis(): number }).toMillis() : null;
/** A match document with its server times as epoch ms (core/antifraud.ts works on numbers). */
function matchFrom(data: DocumentData, id: string): Match {
  const v = data.verification as Record<string, unknown> | null | undefined;
  // 1.4.4 (QA V143-1): the stored summary is untrusted – what the app shows and counts is the replay of the events
  const replay = replayMatchData(data);
  return {
    ...(data as Match),
    ...replay,
    id,
    // 1.4.1 (V140-8): new docs carry no createdAt (rules refuse a client value); older docs keep theirs
    createdAt: ms(data.createdAt) ?? ms(data.startedAt) ?? ms(data.scheduledAt) ?? ms(data.updatedAt) ?? 0,
    startedServerAt: ms(data.startedServerAt),
    finishedServerAt: ms(data.finishedServerAt),
    verification: v ? ({ ...v, at: ms(v.at), reviewedAt: ms(v.reviewedAt) } as Match['verification']) : null,
    // 1.3.9 (V138-11): derived from the captain's answer time, never stored over a match time
    confirmedAt: v ? confirmedAtOf({ verification: { ...(v as object), at: ms(v.at) } as Match['verification'], reopenEpoch: data.reopenEpoch ?? 0 }) : null,
    // 1.4.5 (QA V144-1/2): server times (request.time in the rules) as ms
    abandon: data.abandon ? ({ ...data.abandon, at: ms(data.abandon.at), reviewedAt: ms(data.abandon.reviewedAt), reportedAt: ms(data.abandon.reportedAt) } as Match['abandon']) : null,
    abandonRequest: data.abandonRequest ? ({ ...data.abandonRequest, at: ms(data.abandonRequest.at) ?? 0 } as Match['abandonRequest']) : null,
    resolution: data.resolution ? ({ ...data.resolution, at: ms(data.resolution.at) ?? 0 } as Match['resolution']) : null,
    scorerReassign: data.scorerReassign ? ({ ...data.scorerReassign, at: ms(data.scorerReassign.at) ?? 0 } as Match['scorerReassign']) : null,
    // 1.4.6 (QA V145-5/12)
    abandonHistory: Array.isArray(data.abandonHistory)
      ? (data.abandonHistory as Record<string, unknown>[]).map((a) => ({ ...a, at: ms(a.at), reviewedAt: ms(a.reviewedAt), reportedAt: ms(a.reportedAt) }) as unknown as NonNullable<Match['abandonHistory']>[number])
      : null,
    abandonRequestAt: ms(data.abandonRequestAt),
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
type LogBase = { events: Match['events']; rules: Match['rules']; firstServe: Side; status?: Match['status']; maxEvents?: number | null };
function logOf(m: Match): LogBase {
  return { events: m.events ?? [], rules: m.rules, firstServe: m.firstServe ?? 'A', status: m.status, maxEvents: m.maxEvents ?? null };
}
/**
 * 1.4.5 (QA V144-1): the bookkeeping a scoring write carries (firestore.rules maxEvOk / finishingWriteOk): on a match
 * that isn't stored as finished every events write states maxEvents = max(stored maxEvents or old length, new length),
 * and the write that finishes it sets the wasWon latch. A finished match's re-credit carries neither (finishedWriteOk).
 */
function marksFor(prevStatus: Match['status'] | undefined, base: { maxEvents?: number | null; events?: Match['events'] } | undefined, events: Match['events'], status: Match['status']): { maxEvents?: number; wasWon?: boolean } {
  if (prevStatus === 'finished') return {};
  return { maxEvents: base ? nextMaxEvents(base, events) : events.length, ...(status === 'finished' ? { wasWon: true } : {}) };
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

export { clean };

/**
 * Photo blob checked on the client (services/photoFile.ts): allow-listed declared type, magic bytes,
 * per-type minimum and 10 MB maximum. Unknown types are refused, never relabelled as JPEG (retest
 * 1.1.0 NB-P3); storage.rules check the type and size again.
 */
const photoBlob = (uri: string) => readPhoto(uri);

import { approxDocBytes, newReadBudget, pagedReads, budgetedProfiles, RANKING_READ, type RankingTier, type ReadBudget } from './readBudget';
export { approxDocBytes, budgetedProfiles, newReadBudget, pageSizeFor, pagedReads, RANKING_READ, type RankingTier, type ReadBudget } from './readBudget';

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
    // 1.3.7: names on the public profile; dob / email / pincode / district / state in the owner-only doc
    // (firestore.rules users/{uid}/private/registration). A save is checked together with the stored
    // fields (R136-3); the age range only when the DOB is new or changed (R136-8).
    const { dob: _dob, email: _email, pincode: _pin, district: _district, state: _state, ...rest } = p0 as UserProfile;
    let pub: Omit<UserProfile, 'dob' | 'email' | 'pincode' | 'district' | 'state'> = rest;
    let reg: Record<string, unknown> | null = null;
    // 1.4.0 (QA V139-3): one email per account – a new or changed address is claimed (emails/{id}) in the
    // same transaction; someone else's claim → email_taken. The old claim (if it is ours) is released.
    let claim: ReturnType<typeof doc> | null = null;
    let release: ReturnType<typeof doc> | null = null;
    if (sentRegistration(p0)) {
      const curPub = cur.exists() ? (cur.data() as UserProfile) : null;
      const priv = await getDoc(doc(this.fb.db, 'users', p0.id, 'private', 'registration')).catch(() => null);
      const stored = { firstName: curPub?.firstName ?? null, lastName: curPub?.lastName ?? null, ...(priv?.exists() ? (priv.data() as { dob?: string; email?: string | null; pincode?: string }) : {}) };
      const f = checkRegistrationUpdate(p0, stored, MIN_AGE);
      // 1.3.8 (V137-5): same as the API without a lookup – an unallocated prefix is refused, and no
      // client-typed district/state is stored (firestore.rules registrationOk refuses both)
      if (!pincodePrefixOk(f.pincode) && !isApsPincode(f.pincode)) throw Object.assign(new CodedError('pincode_unknown', 'No post office has this pincode'), { field: 'pincode' });
      pub = { ...pub, firstName: f.firstName, lastName: f.lastName, name: fullName(f.firstName, f.lastName) };
      const oldEmail = stored.email ?? null;
      // 1.4.1 (V140-3): the stored address in another form (a pre-1.4.0 NFD address) is the same address –
      // if someone else has since claimed the normalised form, the stored value is kept as it is (the rules
      // accept an unchanged email without a claim), so the profile still saves.
      if (f.email && oldEmail && oldEmail !== f.email && emailKey(oldEmail) === f.email) {
        const other = await getDoc(doc(this.fb.db, 'emails', emailClaimId(f.email))).then(() => false, (err: { code?: string }) => err?.code === 'permission-denied');
        if (other) f.email = oldEmail;
      }
      reg = clean({ dob: f.dob, email: f.email, pincode: f.pincode, updatedAt: serverTimestamp() });
      if (f.email && f.email !== oldEmail) claim = doc(this.fb.db, 'emails', emailClaimId(f.email));
      if (oldEmail && oldEmail !== f.email) {
        const r = await getDoc(doc(this.fb.db, 'emails', emailClaimId(oldEmail))).catch(() => null); // a 1.3.x address may have no claim
        if (r?.exists() && (r.data() as { uid?: string }).uid === p0.id) release = r.ref;
      }
    }
    const p = checkProfileFields(pub as UserProfile);
    const emailTaken = () => Object.assign(new CodedError('email_taken', 'This email is already used by another account.'), { field: 'email' });
    try {
      await runTransaction(this.fb.db, async (tx) => {
        if (claim) {
          const c = await tx.get(claim); // someone else's claim can't be read: permission-denied
          if (c.exists() && (c.data() as { uid?: string }).uid !== p0.id) throw emailTaken();
          if (!c.exists()) tx.set(claim, { uid: p0.id });
        }
        if (reg) tx.set(doc(this.fb.db, 'users', p0.id, 'private', 'registration'), reg);
        tx.set(doc(this.fb.db, 'users', p.id), clean(p), { merge: true });
        tx.set(doc(this.fb.db, 'phoneIndex', p.phone), { uid: p.id });
        if (release) tx.delete(release);
      });
    } catch (e) {
      if (claim && (e as { code?: string })?.code === 'permission-denied') {
        // was it the claim? (a missing or own claim is readable)
        const c = await getDoc(claim).then(() => null, (err: { code?: string }) => err);
        if (c?.code === 'permission-denied') throw emailTaken();
      }
      throw e;
    }
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
    // 1.4.4 (QA V143-5): the document is built by firebaseMatchDoc.ts, which rules-tests use as well
    const teams = await this.getTeams([m.teamA.teamId, m.teamB.teamId].filter((x): x is string => !!x));
    const cap = (t: Match['teamA']) => (t.teamId ? teams.get(t.teamId)?.captainId ?? null : null);
    guardCreate(matchCreateBase(m), { A: cap(m.teamA), B: cap(m.teamB) });
    const doc0 = matchCreateChecked(m);
    await this.checkMatch(doc0);
    const r = await addDoc(collection(this.fb.db, 'matches'), matchCreateDoc(doc0, Date.now(), serverTimestamp));
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
      let cm: Match | null = null;
      try {
        const cur = await getDoc(ref);
        if (cur.exists()) cm = matchFrom(cur.data(), id);
      } catch {
        // no cached copy: write directly; the rules decide
      }
      if (cm) {
        // 1.3.0: closed after the POTM / abandon, one-way statuses; 1.4.2 (V141-8): a finished match's score is
        // fixed (the rules refuse all of it anyway – 1.4.1 swallowed this check together with read errors)
        guardProgress(cm, p.status, p.events);
        base = logOf(cm);
      }
    }
    // 1.4.2 (QA V141-8): a finished match's score never changes (firestore.rules refuse it too)
    if (base) {
      const f = finishedScoreProblem(base, p.events, p.status);
      if (f) throw new CodedError(f, GUARD_MESSAGES[f]);
    }
    const writes: Promise<void>[] = [];
    let prev = base?.status;
    // times are never the device's guess: start/finish fields come from the status change only
    const { finishedAt: _f, startedAt: _st, ...rest } = p;
    if (base) {
      const steps = planEventSteps(base.events, p.events);
      let mx = base.maxEvents ?? null;
      for (const ev of steps.slice(0, -1)) {
        const st = computeState(base.rules, ev, base.firstServe);
        const status: Match['status'] = st.finished ? 'finished' : p.status === 'finished' ? 'live' : p.status;
        const marks = marksFor(prev, { maxEvents: mx, events: base.events }, ev, status);
        if (marks.maxEvents !== undefined) mx = marks.maxEvents;
        writes.push(updateDoc(ref, clean({
          events: ev,
          summary: summarize(st),
          status,
          ...marks,
          ...startFields(prev, status),
          ...finishFields(prev, status),
          updatedAt: Date.now(),
          serverUpdatedAt: serverTimestamp(),
        }) as DocumentData));
        prev = status;
      }
      base = { ...base, maxEvents: mx };
    }
    // Unknown stored status (no cache): only a finishing write carries the finish times.
    const times = prev === undefined ? (p.status === 'finished' ? finishFields(undefined, 'finished') : {}) : { ...startFields(prev, p.status), ...finishFields(prev, p.status) };
    const marks = marksFor(prev, base, p.events, p.status);
    if (base) this.lastLog.set(id, { ...base, events: p.events, status: p.status, maxEvents: marks.maxEvents ?? base.maxEvents });
    writes.push(updateDoc(ref, clean({ ...rest, ...marks, ...times, updatedAt: Date.now(), serverUpdatedAt: serverTimestamp() }) as DocumentData));
    await Promise.all(writes);
  }
  async updateMatch(id: string, patch: Partial<Match>) {
    const cur = await getDoc(doc(this.fb.db, 'matches', id));
    if (!cur.exists()) throw new Error('Match not found');
    const before = matchFrom(cur.data(), id);
    // 1.4.5 (QA V144-1): {status: 'abandoned'} is the abandon action (records who, when, the score; policy switch)
    if (patch.status === 'abandoned' && (before.status === 'live' || before.status === 'scheduled')) {
      if (Object.keys(patch).some((k) => k !== 'status' && k !== 'updatedAt')) throw new CodedError(MATCH_STATUS_MOVE, GUARD_MESSAGES[MATCH_STATUS_MOVE]);
      await this.abandonMatch(id);
      return;
    }
    // 1.3.0 (QA N121-1/N121-3, INFO): no client times, one-way statuses, closed when terminal.
    guardUpdate(before, patch);
    // 1.4.5 (QA V144-8, interim): after the first rally only to the scorer's own side (firestore.rules handoverOk;
    // the rules can't see another user's admin claim, so "to an admin" is the admin's own reassignment here)
    if (patch.scorerId !== undefined && patch.scorerId !== before.scorerId) {
      const hp = handoverProblem(before, patch.scorerId);
      if (hp) throw new CodedError(hp, HANDOVER_MESSAGES[hp]);
    }
    // 1.4.4 (QA V143-2/3): what the rules refuse because they can't replay the match (clear message first)
    const fbProblem = firebaseUpdateProblem(before, patch);
    if (fbProblem) throw new CodedError(fbProblem, GUARD_MESSAGES[fbProblem]);
    const p = checkMatchFields({ ...patch }, { scheduleChanged: patch.scheduledAt != null && patch.scheduledAt !== before.scheduledAt, status: before.status }) as Partial<Match>;
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
  // ---------- 1.4.5 (QA V144-1/2/3): abandon, consent request, admin resolution (core/abandon.ts; firestore.rules
  // scorerAbandonOk / abandonRequestOk / adminResolveOk). Times in the records are the server's (request.time). ----------
  private async matchRaw(id: string) {
    const cur = await getDoc(doc(this.fb.db, 'matches', id));
    if (!cur.exists()) throw new Error('Match not found');
    return { raw: cur.data(), m: matchFrom(cur.data(), id) };
  }
  async abandonMatch(matchId: string) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { raw, m } = await this.matchRaw(matchId);
    const plan = planAbandon(m, me, Date.now());
    await updateDoc(doc(this.fb.db, 'matches', matchId), abandonDoc(plan, raw, fx(), Date.now()) as DocumentData);
    return plan.kind === 'request' ? ('requested' as const) : ('abandoned' as const);
  }
  async answerAbandonRequest(matchId: string, action: AbandonAnswer) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { raw, m } = await this.matchRaw(matchId);
    const patch = answerAbandon(m, me, action, Date.now());
    const out: Record<string, unknown> = { updatedAt: Date.now() };
    // the request keeps its stored server time; the closing agreement stamps the abandon record with the request time
    if (patch.abandonRequest !== undefined) out.abandonRequest = patch.abandonRequest ? { ...patch.abandonRequest, at: raw.abandonRequest.at } : null;
    if (patch.status) Object.assign(out, { status: patch.status, finishedAt: Date.now() });
    if (patch.abandon) out.abandon = { ...patch.abandon, at: serverTimestamp() };
    await updateDoc(doc(this.fb.db, 'matches', matchId), clean(out) as DocumentData);
  }
  async resolveMatch(matchId: string, action: ResolveAction) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { raw, m } = await this.matchRaw(matchId);
    const patch = resolvePatch(m, me, await this.isAdmin(me), action, Date.now());
    await updateDoc(doc(this.fb.db, 'matches', matchId), resolveDoc(raw, m, patch, me, fx(), Date.now()) as DocumentData);
  }
  async reportAbandon(matchId: string) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { raw, m } = await this.matchRaw(matchId);
    reportAbandon(m, me, Date.now()); // throws unless allowed (core/lifecycle.ts 'report')
    await updateDoc(doc(this.fb.db, 'matches', matchId), reportDoc(raw, me, fx(), Date.now()) as DocumentData);
  }
  async reassignScorer(matchId: string, scorerId: string) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { m } = await this.matchRaw(matchId);
    const p = reassignProblem(m, me, await this.isAdmin(me), scorerId);
    if (p) throw new CodedError(p, HANDOVER_MESSAGES[p] ?? GUARD_MESSAGES[p] ?? p);
    const rec = reassignRecord(m, me, scorerId, Date.now());
    await updateDoc(doc(this.fb.db, 'matches', matchId), reassignDoc(scorerId, rec, fx(), Date.now()) as DocumentData);
  }
  async repairVerdict(matchId: string, fix: RepairFix) {
    const me = this.fb.auth.currentUser?.uid ?? '';
    const { m } = await this.matchRaw(matchId);
    const patch = repairPatch(m, me, await this.isAdmin(me), fix, Date.now()); // throws unless allowed
    await updateDoc(doc(this.fb.db, 'matches', matchId), repairDoc(patch, fx(), Date.now()) as DocumentData);
  }
  watchLiveMatches(cb: (m: Match[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches'), where('status', 'in', ['live', 'scheduled']), limit(50)), (s) =>
      cb(s.docs.map((d) => matchOf(d)).sort((a, b) => b.updatedAt - a.updatedAt)),
    );
  }
  watchMyMatches(uid: string, cb: (m: Match[]) => void) {
    return onSnapshot(query(collection(this.fb.db, 'matches'), where('participantIds', 'array-contains', uid), limit(200)), (s) =>
      cb(s.docs.map((d) => matchOf(d)).sort(byMatchDateDesc)), // 1.3.9 (V138-11): not by updatedAt
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
      .sort(byMatchDateDesc)
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
  private async countableMatches(extra: Match[] = [], budget: ReadBudget = newReadBudget()): Promise<Match[]> {
    const col = collection(this.fb.db, 'matches');
    // 1.4.6 (QA V145-8): tiers in priority order within one hard budget (RANKING_READ). Errors are no longer swallowed
    // (1.4.5's .catch(() => []) hid a failing approved query): a missing index or a refused read fails the call.
    const approved = await this.pagedDocs(query(col, where('verification.status', '==', 'approved'), orderBy('verification.reviewedAt', 'desc')), RANKING_READ.MAX_APPROVED, budget, 'approved');
    const confirmed = await this.pagedDocs(query(col, where('verification.status', '==', 'confirmed'), orderBy('finishedServerAt', 'desc')), RANKING_READ.MAX_CONFIRMED, budget, 'confirmed');
    const byServer = await this.pagedDocs(query(col, where('status', '==', 'finished'), orderBy('finishedServerAt', 'desc')), RANKING_READ.MAX_FINISHED, budget, 'finished');
    const seen = new Map<string, Match>();
    for (const m of extra) if (m.status === 'finished') seen.set(m.id, m);
    for (const d of [...approved, ...confirmed, ...byServer]) if (!seen.has(d.id)) seen.set(d.id, matchOf(d));
    const out = [...seen.values()];
    await this.markUnknownPlayers(out, budget);
    return out;
  }
  /** Pages of a query within the tier's share of the budget; never asks for more than the bytes left can hold. */
  private async pagedDocs(q: ReturnType<typeof query>, max: number, budget: ReadBudget, tier: RankingTier) {
    return pagedReads<QueryDocumentSnapshot<DocumentData>>(
      async (n, last) => (await getDocs(query(q, ...(last ? [startAfter(last)] : []), limit(n)))).docs as QueryDocumentSnapshot<DocumentData>[],
      (d) => approxDocBytes(d.data() as DocumentData),
      max,
      budget,
      tier,
    );
  }
  /** User ids known to have a profile (cached for the session; profiles are never deleted by the app). */
  private knownUsers = new Set<string>();
  /**
   * 1.4.5 (PRD gap): the rules check only the captains and the first 3 players of a side built by number, so later
   * players can be made-up ids. For matches that could count (completed and confirmed/approved – a confirmation needs
   * the real opposing captain), players without a profile are listed in unknownPlayerIds: the match is flagged
   * 'unknown_players' and those ids never get credit (core/antifraud.ts).
   */
  private async markUnknownPlayers(list: Match[], budget: ReadBudget) {
    const cands = list.filter((m) => isCompleted(m) && ['confirmed', 'approved'].includes(verificationStatus(m)));
    const ids = [...new Set(cands.flatMap((m) => [...m.teamA.players, ...m.teamB.players].map((p) => p.id)))].filter((x) => x && !this.knownUsers.has(x));
    // 1.4.7 (QA V146-4): within the call's read budget, and errors propagate (1.4.6 swallowed them and marked nothing).
    // Ids the budget can't cover this time count as unknown (fail closed: no credit, flagged for review); they are
    // checked first on the next call, since the ones found are cached.
    const { found } = await budgetedProfiles(
      ids,
      async (part) => (await getDocs(query(collection(this.fb.db, 'users'), where(documentId(), 'in', part)))).docs.map((d) => ({ id: d.id, bytes: approxDocBytes(d.data() as DocumentData) })),
      budget,
    );
    for (const id of found) this.knownUsers.add(id);
    for (const m of cands) {
      const unknown = [...m.teamA.players, ...m.teamB.players].map((p) => p.id).filter((x) => !this.knownUsers.has(x));
      if (unknown.length) m.unknownPlayerIds = unknown;
    }
  }
  async getWallet(uid: string): Promise<WalletResult> {
    // 1.4.6 (QA V145-8): the player's own matches are paged (document-id order: no extra index) within the same hard
    // budget, their share first
    const budget = newReadBudget();
    const mine = await this.pagedDocs(query(collection(this.fb.db, 'matches'), where('participantIds', 'array-contains', uid)), RANKING_READ.MAX_OWN, budget, 'own');
    return playerWallet(await this.countableMatches(mine.map(matchOf), budget), uid);
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
    // 1.4.6 (QA V145-2): after a re-open the verdict carries the epoch (firebaseActionDocs.verifyDoc)
    await updateDoc(doc(this.fb.db, 'matches', matchId), verifyDoc(s.data(), me, status, reason, fx(), Date.now()) as DocumentData);
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
    // 1.4.5 (QA V144-2): a match stored as finished without a winner can be voided too (firestore.rules reviewOk)
    const winnerless = m.status === 'finished' && !matchOver({ ...m, status: 'live' });
    if (!isCompleted(m) && !(winnerless && decision === 'void')) throw new CodedError('not_completed', CONFIRM_MESSAGES.not_completed);
    const v = verificationStatus(m);
    if (v === 'approved' || v === 'voided') throw new CodedError('already_reviewed', CONFIRM_MESSAGES.already_reviewed);
    if (ownMatchReview(m, me)) throw new CodedError(OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE);
    // 1.3.8 (V137-1): the captain's verdict is written explicitly, also when it was only in the older
    // fields (a 1.3.6 client confirmed without `captain`); firestore.rules reviewOk accepts exactly that.
    await updateDoc(doc(this.fb.db, 'matches', matchId), reviewDoc(s.data(), me, decision, captainVerdict(m), fx(), Date.now()) as DocumentData);
  }
  // ---------- 1.3.7 feedback + fact of the day (firestore.rules: feedback create-own, admin read; dailyItems public read, admin write) ----------
  async sendFeedback(f: { stars: number; text: string; appVersion?: string }) {
    const me = this.fb.auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    const c = checkFeedback(f);
    await addDoc(collection(this.fb.db, 'feedback'), { userId: me, stars: c.stars, text: c.text, appVersion: c.appVersion, createdAt: serverTimestamp() });
  }
  // 1.4.19 support tickets: supportTickets/{id} (firestore.rules) + support/{uid}/{id}.{ext} (storage.rules)
  async createSupportTicket(t: NewSupportTicket) {
    const me = this.fb.auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    const c = checkSupportTicket(t);
    const ref0 = doc(collection(this.fb.db, 'supportTickets'));
    let screenshotPath: string | null = null;
    if (t.screenshot) {
      const { blob, type } = await photoBlob(t.screenshot.uri);
      assertSupportImage(type, blob.size);
      screenshotPath = `support/${me}/${ref0.id}.${SUPPORT_IMAGE_TYPES[type]}`;
      await uploadBytes(ref(this.fb.storage, screenshotPath), blob, { contentType: type });
    }
    await setDoc(ref0, { userId: me, topic: c.topic, message: c.message, appVersion: c.appVersion, status: 'open', screenshotPath, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref0.id;
  }
  private async ticketsFrom(q: ReturnType<typeof query>) {
    const snap = await getDocs(q);
    const ms = (v: unknown) => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : 0);
    return Promise.all(snap.docs.map(async (d) => {
      const x = d.data() as Record<string, unknown>;
      const path = x.screenshotPath as string | null;
      return { id: d.id, userId: x.userId as string, topic: x.topic, message: x.message as string, appVersion: (x.appVersion as string) ?? null, status: x.status,
        screenshotUrl: path ? await getDownloadURL(ref(this.fb.storage, path)).catch(() => null) : null, createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt) } as SupportTicket;
    }));
  }
  async listMySupportTickets() {
    const me = this.fb.auth.currentUser?.uid;
    if (!me) throw new Error('Not signed in yet');
    return this.ticketsFrom(query(collection(this.fb.db, 'supportTickets'), where('userId', '==', me), orderBy('createdAt', 'desc'), limit(100)));
  }
  async listSupportTickets() {
    return this.ticketsFrom(query(collection(this.fb.db, 'supportTickets'), orderBy('createdAt', 'desc'), limit(200)));
  }
  async setSupportTicketStatus(id: string, status: SupportStatus) {
    await updateDoc(doc(this.fb.db, 'supportTickets', id), { status: checkSupportStatus(status), updatedAt: serverTimestamp() });
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
  // 1.3.9 (V137-4): review prompt clock = server time (firestore.rules private/review: each stamp == request.time)
  async reviewClock(uid: string) {
    const ref = doc(this.fb.db, 'users', uid, 'private', 'review');
    await setDoc(ref, { checkedAt: serverTimestamp() }, { merge: true });
    const snap = await getDoc(ref);
    const ms = (v: unknown) => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);
    const now = ms(snap.get('checkedAt'));
    if (now == null) throw new Error('no server time');
    return { now, lastAskedAt: ms(snap.get('lastAskedAt')) };
  }
  async markReviewAsked(uid: string) {
    await setDoc(doc(this.fb.db, 'users', uid, 'private', 'review'), { lastAskedAt: serverTimestamp() }, { merge: true });
  }
  async listDailyItems(opts?: { all?: boolean }) {
    const snap = await getDocs(collection(this.fb.db, 'dailyItems'));
    const out: DailyItem[] = [];
    const toMs = (v: unknown) => (typeof (v as { toMillis?: () => number } | null)?.toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);
    snap.forEach((d) => {
      const x = d.data() as Omit<DailyItem, 'id' | 'createdAt' | 'removedAt'> & { createdAt?: unknown; removedAt?: unknown; updatedAt?: unknown };
      const { updatedAt: _u, createdAt, removedAt, ...rest } = x;
      out.push({ ...rest, id: d.id, createdAt: toMs(createdAt), removedAt: toMs(removedAt) });
    });
    // 1.4.1 (V140-7): the public list keeps items that are off / deleted as tombstones (rotation slots)
    return opts?.all ? out.filter((x) => !x.deleted) : out.map((x) => (x.active !== false ? x : dailyTombstone(x)));
  }
  async saveDailyItem(item: Partial<DailyItem>) {
    const c = checkDailyItem(item);
    // 1.3.9 (V138-7): createdAt is the server's time on create and never changes; 1.4.1 (V140-7): removedAt
    // is the server's time when it is turned off, set once (firestore.rules dailyItems). Turning an item back
    // on creates a copy and marks the old doc deleted, in one batch.
    const old = item.id ? await getDoc(doc(this.fb.db, 'dailyItems', item.id)) : null;
    if (item.id && (!old?.exists() || old.get('deleted') === true)) throw new Error('Item not found');
    const fresh = () => doc(collection(this.fb.db, 'dailyItems'));
    if (old?.exists()) {
      const wasActive = old.get('active') !== false;
      if (!wasActive && c.active) {
        const ref = fresh();
        const b = writeBatch(this.fb.db);
        // it is off: removedAt stays as it is (none = pre-1.4.1, in no cycle); 1.4.2 (V141-6): the tombstone keeps no text
        b.update(old.ref, { deleted: true, ...tombstoneBlank(), updatedAt: serverTimestamp() });
        b.set(ref, clean({ ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
        await b.commit();
        return ref.id;
      }
      const removedAt = wasActive ? (c.active ? null : serverTimestamp()) : old.get('removedAt') ?? null;
      await setDoc(old.ref, clean({ ...c, updatedAt: serverTimestamp(), createdAt: old.get('createdAt') ?? null, removedAt }));
      return old.id;
    }
    const ref = fresh();
    await setDoc(ref, clean({ ...c, updatedAt: serverTimestamp(), createdAt: serverTimestamp(), removedAt: c.active ? null : serverTimestamp() }));
    return ref.id;
  }
  async deleteDailyItem(id: string) {
    // 1.4.1 (V140-7): deleting leaves a tombstone (firestore.rules: no delete; deleted = true, off, removedAt set once)
    const ref = doc(this.fb.db, 'dailyItems', id);
    const old = await getDoc(ref);
    if (!old.exists()) return;
    // 1.4.2 (QA V141-6): the tombstone keeps no text (public read); a 1.4.1 tombstone that still has it is scrubbed
    if (old.get('deleted') === true) {
      if (old.get('textEn')) await updateDoc(ref, { ...tombstoneBlank(), updatedAt: serverTimestamp() });
      return;
    }
    await updateDoc(ref, { deleted: true, active: false, ...tombstoneBlank(), ...(old.get('active') === false ? {} : { removedAt: serverTimestamp() }), updatedAt: serverTimestamp() });
  }
  async listFlagged() {
    if (!(await this.isAdmin(this.fb.auth.currentUser?.uid ?? ''))) return [];
    // 1.4.5 (QA V144-1/2): plus abandoned matches waiting for review (flagged, or older ones with rallies and no
    // record), matches stored as finished without a winner (in countableMatches) and pending abandon requests
    // 1.4.7 (QA V146-4): the 3 extra queries are paged within the same read budget as the countable matches (their own
    // 'flagged' share first), and a failing query fails the list (1.4.6 turned a failed query into an empty one).
    const col = collection(this.fb.db, 'matches');
    const budget = newReadBudget();
    const extra: QueryDocumentSnapshot<DocumentData>[] = [];
    for (const q of [
      query(col, where('abandon.review', '==', 'pending')),
      query(col, where('status', '==', 'abandoned')),
      query(col, where('abandonRequest.side', 'in', ['A', 'B', 'N'])),
    ]) extra.push(...(await this.pagedDocs(q, RANKING_READ.MAX_FLAGGED, budget, 'flagged')));
    const seen = new Map<string, Match>();
    for (const m of await this.countableMatches([], budget)) seen.set(m.id, m);
    for (const d of extra) if (!seen.has(d.id)) seen.set(d.id, matchOf(d));
    return [...seen.values()].filter((m) => needsReview(m) || needsAdminAction(m));
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
    // 1.4.19: the owner only (core/tournamentAdmin; the rules enforce it too) – a coded answer instead of a bare denial
    const cur = await getDoc(doc(this.fb.db, 'tournaments', id));
    if (cur.exists()) guardTournamentEdit(cur.data() as Tournament, this.fb.auth.currentUser?.uid, patch);
    await updateDoc(doc(this.fb.db, 'tournaments', id), clean(p) as DocumentData);
  }
  async deleteTournament(id: string) {
    const cur = await getDoc(doc(this.fb.db, 'tournaments', id));
    if (!cur.exists()) throw new Error('Tournament not found');
    assertTournamentAdmin(cur.data() as Tournament, this.fb.auth.currentUser?.uid);
    await deleteDoc(doc(this.fb.db, 'tournaments', id));
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
