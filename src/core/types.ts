/** Domain types shared by the app and both backends. */
import type { Place } from './geo';
import type { RuleSet } from './rules';
import type { MatchEvent, MatchSummary, Side } from './scoring';
import type { Lineups } from './rotation';
import type { Fixture, TournamentFormat } from './tournament';

export type Position = 'setter' | 'outside' | 'middle' | 'opposite' | 'libero' | 'any';
export const POSITIONS: { id: Position; label: string }[] = [
  { id: 'setter', label: 'Setter' },
  { id: 'outside', label: 'Outside hitter' },
  { id: 'middle', label: 'Middle blocker' },
  { id: 'opposite', label: 'Opposite' },
  { id: 'libero', label: 'Libero' },
  { id: 'any', label: 'All-rounder' },
];

export interface UserProfile {
  id: string; // = auth uid
  name: string;
  phone: string; // E.164
  photoURL?: string | null;
  position: Position;
  city?: string;
  pushToken?: string | null;
  createdAt: number;
}

export const TEAM_SIZE = 6;
export const MAX_SUBS = 6;

export interface Team {
  id: string;
  name: string;
  nameLower: string;
  color: string;
  captainId: string;
  /** All accepted members (starters + subs), including the captain. */
  memberIds: string[];
  /** Subset of memberIds who are substitutes. */
  subIds: string[];
  /** E.164 numbers of REGISTERED users invited in-app but not yet accepted. */
  pendingPhones: string[];
  city?: string;
  createdAt: number;
}

/** A player in a match: always a registered user. `name`/`photoURL` are a display copy of their profile. */
export interface MatchPlayer {
  id: string; // user id (uid); typed names are not allowed (see core/roster.ts)
  name: string;
  photoURL?: string | null;
}

/**
 * One side of a match: a registered team (`teamId`, players = its members) or a side built for
 * this match by adding registered players by mobile number (`teamId: null`, not saved as a team).
 * Either way 6..12 players are needed before scoring starts (MIN_PLAYERS / MAX_PLAYERS).
 */
export interface MatchTeam {
  teamId?: string | null;
  name: string;
  color: string;
  players: MatchPlayer[];
}

export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'abandoned';

/** Reserved for live video (deferred). */
export interface StreamInfo {
  provider: 'none' | 'rtmp' | 'webrtc' | 'youtube';
  playbackUrl?: string;
  ingestUrl?: string; // never shown to followers
  live: boolean;
}

export interface Match {
  id: string;
  title?: string;
  teamA: MatchTeam;
  teamB: MatchTeam;
  rules: RuleSet;
  firstServe: Side;
  events: MatchEvent[];
  summary: MatchSummary;
  status: MatchStatus;
  createdBy: string;
  /** The only user allowed to change the score. */
  scorerId: string;
  /** Everyone involved (players, scorer, creator) – used for history queries. */
  participantIds: string[];
  location?: Place | null;
  scheduledAt?: number | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  tournamentId?: string | null;
  fixtureId?: string | null;
  challengeId?: string | null;
  stream?: StreamInfo | null;
  /** Players who tapped "I want to play" on a scheduled match. */
  interestedIds?: string[];
  /** Starting lineup (court positions 1–6) per set, set by the scorer. Missing = default roster order. */
  lineups?: Lineups | null;
  /**
   * Player of the Match (a player id of team A or B), confirmed by the scorer when the match
   * finishes (core/potm.ts). Missing/null = not chosen. Cleared again if the scorer undoes the
   * match-winning rally.
   */
  playerOfMatchId?: string | null;
  /**
   * 1.3.0 anti-fraud (core/antifraud.ts). Captains of side A and B, fixed when the match is created:
   * a registered team's captain, or (side built by number) a player of that side named by the creator.
   */
  captains?: MatchCaptains | null;
  /** Result confirmation by the opposing captain / admin review. Written only by the server/rules-validated actions. */
  verification?: MatchVerification | null;
  /** Server clock (ms) when the match went live / finished. Never taken from the client. */
  startedServerAt?: number | null;
  finishedServerAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface MatchCaptains {
  A: string;
  B: string;
}

/**
 * pending: awaiting the opposing captain; confirmed: confirmed by them; disputed: rejected by them
 * (flagged for an admin); approved / voided: an admin reviewed it. Missing = pending.
 */
export type VerificationStatus = 'pending' | 'confirmed' | 'disputed' | 'approved' | 'voided';
export interface MatchVerification {
  status: VerificationStatus;
  /** Captain who confirmed or rejected. */
  by?: string | null;
  at?: number | null;
  /** Reject reason (max 200 chars, plain text). */
  reason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: number | null;
}

export interface MatchPhoto {
  id: string;
  matchId: string;
  url: string;
  storagePath?: string;
  uploadedBy: string;
  createdAt: number;
  /** 1.3.4: sha256 (hex) of the image bytes, for per-match de-duplication. Absent on older photos. */
  hash?: string | null;
}

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Challenge {
  id: string;
  fromTeamId: string;
  fromTeamName: string;
  fromCaptainId: string;
  toTeamId: string;
  toTeamName: string;
  toCaptainId: string;
  when: number;
  location: Place;
  message?: string;
  rules: RuleSet;
  status: ChallengeStatus;
  matchId?: string | null;
  createdAt: number;
}

/** A team in a tournament: always a registered team (`id` is the team's id, at least MIN_PLAYERS members when added). */
export interface TournamentTeam {
  id: string;
  name: string;
  color: string;
}

export interface Tournament {
  id: string;
  name: string;
  organizerId: string;
  format: TournamentFormat;
  rules: RuleSet;
  startDate: number;
  endDate: number;
  location: Place;
  teams: TournamentTeam[];
  fixtures: Fixture[];
  status: 'registration' | 'running' | 'finished';
  createdAt: number;
}

export interface Court {
  id: string;
  name: string;
  location: Place;
  surface: 'indoor' | 'beach' | 'grass' | 'outdoor';
  addedBy: string;
  createdAt: number;
}

export const TEAM_COLORS = [
  '#D93636', // red (Team A default, theme colors.teamA; white text ≥4.5:1, ≥3:1 against the Team B navy)
  '#001F4D', // deep navy (Team B default, theme colors.teamB)
  '#FF6B00',
  '#1B7F3B',
  '#6A1B9A',
  '#AD1457',
  '#00695C', // teal (replaced the old bright-blue preset so custom teams don't clash with the navy/blue theme, QA V1, N121-7)
  '#795548',
];

/**
 * `color`, or the first palette colour not already `taken` when it clashes (case-insensitive).
 * New teams all start red, so two of them on one scoreboard or in one bracket looked identical
 * (QA bug F). Only the match/tournament copy changes; the team keeps its own colour.
 */
export function distinctColor(color: string, taken: readonly string[]): string {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  if (!used.has(color.toLowerCase())) return color;
  return TEAM_COLORS.find((c) => !used.has(c.toLowerCase())) ?? color;
}

/** Title stored on matches created from an accepted challenge; translated at display (i18n dataLabel). */
export const CHALLENGE_MATCH_TITLE = 'Challenge match';
