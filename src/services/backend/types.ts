import type { DailyItem } from '../../core/dailyItems';
import { isValidE164 } from '../../core/phone';
import type { Place } from '../../core/geo';
import type { MatchEvent, MatchSummary } from '../../core/scoring';
import type { Rankings, RankingRow } from '../../core/ranking';
import type { PlayerWallet } from '../../core/antifraud';
import type { TermsAcceptance } from '../../core/terms';
import type {
  Challenge,
  ChallengeStatus,
  Court,
  Match,
  MatchPhoto,
  Team,
  Tournament,
  UserProfile,
} from '../../core/types';

export type Unsubscribe = () => void;

export interface AuthUser {
  uid: string;
  phoneNumber: string | null;
}

/** Object compatible with Firebase's ApplicationVerifier (reCAPTCHA). */
export interface PhoneVerifier {
  readonly type: string;
  verify(): Promise<string>;
  _reset?(): void;
}

export interface OtpSession {
  confirm(code: string): Promise<void>;
}

export type NewTeam = Omit<Team, 'id' | 'nameLower' | 'createdAt'>;
export type NewMatch = Omit<Match, 'id' | 'createdAt' | 'updatedAt'>;
export type NewChallenge = Omit<Challenge, 'id' | 'createdAt' | 'status' | 'matchId'>;
export type NewTournament = Omit<Tournament, 'id' | 'createdAt'>;
export type NewCourt = Omit<Court, 'id' | 'createdAt'>;

export interface MatchProgress {
  events: MatchEvent[];
  summary: MatchSummary;
  status: Match['status'];
  startedAt?: number | null;
  finishedAt?: number | null;
  /** Never sent since 1.3.0 (a match with a Player of the Match is closed; ignored by every backend). */
  playerOfMatchId?: null;
}

/** Rankings as the UI needs them (src/core/ranking.ts; GET /api/rankings on the server). */
export interface RankingsResult extends Rankings {
  minMatches: number;
  /** The signed-in player's row: ranked, or rank null while under the minimum; null with no finished match. */
  me: RankingRow | null;
  /**
   * QA C130-8: the signed-in player's counted match ids (the matches behind `me`). Profile's Career
   * stats use exactly these, so rank card and Career stats share one source.
   */
  myCountedMatchIds: string[];
}

/** The in-app points wallet (balance only: no cash value, nothing to redeem). */
export type WalletResult = PlayerWallet;
export type ReviewDecision = 'approve' | 'void';

/** Upload progress 0..1 (Firebase Storage reports it; the API and demo report 1 when done). */
export type UploadProgress = (fraction: number) => void;
export interface UploadOptions {
  /** Same key on every retry of one queued photo (the queue item id): the photo is created once. */
  idempotencyKey?: string;
}
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Photo upload for a user other than the signed-in one (a queue item from another account). */
export const PHOTO_WRONG_ACCOUNT = 'photo_wrong_account';

/**
 * Everything the UI needs from a backend. Implemented by ApiBackend (VolleyLive
 * API server + MySQL), FirebaseBackend (Firestore directly) and DemoBackend
 * (local sample data for trying the app).
 */
export interface Backend {
  readonly mode: 'firebase' | 'demo' | 'api';

  // ---- auth ----
  onAuthChanged(cb: (u: AuthUser | null) => void): Unsubscribe;
  sendOtp(phoneE164: string, verifier: PhoneVerifier | null): Promise<OtpSession>;
  signOut(): Promise<void>;

  // ---- profiles ----
  watchProfile(uid: string, cb: (p: UserProfile | null) => void): Unsubscribe;
  saveProfile(p: UserProfile): Promise<void>;
  getProfiles(uids: string[]): Promise<UserProfile[]>;
  findUserByPhone(phoneE164: string): Promise<UserProfile | null>;
  uploadAvatar(uid: string, localUri: string): Promise<string>;
  savePushToken(uid: string, token: string): Promise<void>;

  // ---- T&C (1.3.0) ----
  /** The signed-in user's stored acceptance (null = never accepted). */
  getTerms(uid: string): Promise<TermsAcceptance | null>;
  /** Accepts exactly `version` (server time); the only way the stored version changes. */
  acceptTerms(uid: string, version: string): Promise<void>;
  /** Admin = API: ADMIN_UIDS allow-list; Firebase: the operator-set `admin` custom claim. */
  isAdmin(uid: string): Promise<boolean>;

  // ---- teams ----
  createTeam(t: NewTeam): Promise<string>;
  updateTeam(id: string, patch: Partial<Team>): Promise<void>;
  watchTeam(id: string, cb: (t: Team | null) => void): Unsubscribe;
  watchMyTeams(uid: string, cb: (t: Team[]) => void): Unsubscribe;
  /**
   * Teams that have invited this phone number. `onState` reports 'invalid_phone' for an account
   * from before build 216 whose number isn't an Indian mobile (the list is then empty; fix-retest N4).
   */
  watchTeamInvites(phoneE164: string, cb: (t: Team[]) => void, onState?: (s: InviteState) => void): Unsubscribe;
  acceptTeamInvite(teamId: string, uid: string, phoneE164: string): Promise<void>;
  declineTeamInvite(teamId: string, phoneE164: string): Promise<void>;
  searchTeams(prefix: string): Promise<Team[]>;

  // ---- matches ----
  createMatch(m: NewMatch): Promise<string>;
  watchMatch(id: string, cb: (m: Match | null) => void): Unsubscribe;
  saveMatchProgress(id: string, p: MatchProgress): Promise<void>;
  updateMatch(id: string, patch: Partial<Match>): Promise<void>;
  watchLiveMatches(cb: (m: Match[]) => void): Unsubscribe;
  watchMyMatches(uid: string, cb: (m: Match[]) => void): Unsubscribe;
  watchTournamentMatches(tournamentId: string, cb: (m: Match[]) => void): Unsubscribe;
  /**
   * The scorer confirms the Player of the Match (src/core/potm.ts): once, while the match is
   * finished (within 24 h), to a player of the match. Errors carry a potm_* code.
   */
  setPlayerOfMatch(matchId: string, playerId: string): Promise<void>;
  /** Matches that are scheduled or live and have a location (for the map). */
  listPublicMatches(): Promise<Match[]>;

  // ---- photos ----
  watchPhotos(matchId: string, cb: (p: MatchPhoto[]) => void): Unsubscribe;
  /** Players of the match and its scorer only (core/photos.ts canAddMatchPhoto; code photo_not_allowed otherwise). */
  uploadMatchPhoto(matchId: string, uid: string, localUri: string, onProgress?: UploadProgress, opts?: UploadOptions): Promise<void>;
  /** Deletes a photo the signed-in user uploaded (PRD PHOTO-03; the server/rules allow the uploader only). */
  deleteMatchPhoto(photo: MatchPhoto): Promise<void>;
  /** "Memories": photos from matches this user played in, newest first. */
  listMemories(uid: string): Promise<MatchPhoto[]>;

  // ---- rankings / wallet ----
  getRankings(uid: string): Promise<RankingsResult>;
  getWallet(uid: string): Promise<WalletResult>;

  // ---- result confirmation / review (1.3.0) ----
  /** The opposing captain confirms a completed match's result. */
  confirmResult(matchId: string): Promise<void>;
  /** The opposing captain rejects it (reason <= 200 plain text): the match is flagged. */
  rejectResult(matchId: string, reason: string): Promise<void>;
  /** Admin only: approve (counts) or void (never counts) a completed match, once. */
  reviewMatch(matchId: string, decision: ReviewDecision): Promise<void>;
  /** Admin only: completed matches waiting for a review. */
  listFlagged(): Promise<Match[]>;
  /** 1.3.6: pincode → district/state (API: server lookup with fallback; demo: bundled sample; else format only). */
  lookupPincode?(pin: string): Promise<import('../../core/registration').PincodeInfo>;

  // ---- 1.3.7 feedback + fact of the day ----
  /** Profile > Send feedback (1–5 stars + text; signed in, rate limited). Never rewarded. */
  /** 1.3.8 (V137-4): the server's clock (ms) when known (API: from response Date headers), else null. */
  serverNow?(): number | null;
  sendFeedback(f: { stars: number; text: string; appVersion?: string }): Promise<void>;
  /** Admin only: newest feedback first. */
  listFeedback(): Promise<FeedbackItem[]>;
  /** Fact / quote of the day items (public read, active only; `all` = admins' manage screen). The app falls back to the bundled list. */
  listDailyItems(opts?: { all?: boolean }): Promise<DailyItem[]>;
  /** Admin only: add (no id) or edit an item; returns its id. */
  saveDailyItem(item: Partial<DailyItem>): Promise<string>;
  /** Admin only. */
  deleteDailyItem(id: string): Promise<void>;

  // ---- challenges ----
  createChallenge(c: NewChallenge): Promise<string>;
  watchChallenges(teamIds: string[], cb: (c: Challenge[]) => void): Unsubscribe;
  respondToChallenge(c: Challenge, status: ChallengeStatus, matchId?: string): Promise<void>;

  // ---- tournaments ----
  createTournament(t: NewTournament): Promise<string>;
  updateTournament(id: string, patch: Partial<Tournament>): Promise<void>;
  watchTournament(id: string, cb: (t: Tournament | null) => void): Unsubscribe;
  watchTournaments(cb: (t: Tournament[]) => void): Unsubscribe;

  // ---- courts ----
  addCourt(c: NewCourt): Promise<string>;
  listCourts(): Promise<Court[]>;
}

export type { Place };

export type InviteState = 'ok' | 'invalid_phone';
/** Invites are only listed for an Indian mobile number (the API returns 400 invalid_phone otherwise). */
export const inviteState = (phone: string | null | undefined): InviteState => (phone && isValidE164(phone) ? 'ok' : 'invalid_phone');

/** 1.3.7: one piece of user feedback (admin view). */
export interface FeedbackItem {
  id: string;
  userId: string;
  userName?: string | null;
  stars: number;
  text: string;
  appVersion?: string | null;
  createdAt: number;
}
