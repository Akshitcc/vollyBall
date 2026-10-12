/**
 * 1.4.4 (QA V143-1/2/3/4): on Firebase the stored summary is written by the scorer's client and the rules can't
 * check it against the rallies (no loops), so it is NOT trusted. Every result the app shows or counts – result page,
 * captain confirm, Player of the Match, wallet, leaderboard, abandon eligibility, the "finished" badge – comes from
 * the replay of the events with the shared core (computeState) under the match's rules, which firestore.rules
 * freeze once the first rally exists. firebaseBackend.matchFrom applies this to every match it reads.
 *
 * A stored summary that disagrees with the replay, or a 'finished' status whose events have no winner, is kept
 * as a flag (resultCheck) for admin review: such a match never counts (core/antifraud.ts isCompleted replays it).
 */
import { computeState, summarize, type MatchEvent, type MatchSummary, type Side } from './scoring';
import type { RuleSet } from './rules';
import type { ResultCheck } from './types';

type Replayable = { rules: RuleSet; events?: readonly MatchEvent[] | null; firstServe?: Side | null; status?: string; summary?: unknown };

/** The summary the events give (what the app shows), independent of any stored summary. */
export function replayedSummary(m: Replayable): MatchSummary {
  return summarize(computeState(m.rules, m.events ?? [], m.firstServe ?? 'A'));
}

const sameSummary = (a: MatchSummary, b: unknown): boolean => {
  if (!b || typeof b !== 'object') return false;
  const s = b as Partial<MatchSummary>;
  return s.setsA === a.setsA && s.setsB === a.setsB && s.currentA === a.currentA && s.currentB === a.currentB
    && (s.winner ?? null) === a.winner && Array.isArray(s.setScores) && s.setScores.length === a.setScores.length
    && s.setScores.every((x, i) => !!x && x.a === a.setScores[i].a && x.b === a.setScores[i].b);
};

/**
 * Replay a stored match: the replayed summary plus the review flag. The serving side is a display hint
 * (derived from the events) and is not compared; a missing stored summary (legacy docs) isn't a mismatch.
 */
export function replayStored(m: Replayable): { summary: MatchSummary; resultCheck: ResultCheck | null } {
  const summary = replayedSummary(m);
  let resultCheck: ResultCheck | null = null;
  if (m.status === 'finished' && !summary.winner) resultCheck = 'finished_without_winner';
  else if (m.summary != null && !sameSummary(summary, m.summary)) resultCheck = 'summary_mismatch';
  return { summary, resultCheck };
}
