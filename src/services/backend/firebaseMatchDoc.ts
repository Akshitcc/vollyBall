/**
 * 1.4.4 (QA V143-5): the exact document firebaseBackend.createMatch writes, as a pure function (no Firebase
 * SDK import), so rules-tests/rules.test.js can create matches with the app's own builder instead of
 * hand-made documents. `serverTime` is the SDK's serverTimestamp (passed in by the caller).
 */
import { canonicalParticipants } from '../../core/roster';
import { checkMatchFields } from '../../core/validate';
import type { NewMatchDoc } from '../../core/buildMatch';
import { replayStored } from '../../core/replay';
import type { MatchSummary } from '../../core/scoring';
import type { ResultCheck } from '../../core/types';

/**
 * Drops undefined fields (Firestore refuses them), recursively in plain objects and arrays.
 * 1.3.9: only PLAIN objects are rebuilt – Firestore sentinels (serverTimestamp(), deleteField()) and
 * Timestamp/GeoPoint instances are passed through as they are. Before, clean() copied them into plain maps
 * (e.g. {_methodName:'serverTimestamp'}), so a "server time" field was not a timestamp.
 */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) out[k] = clean(val);
    return out as T;
  }
  return v;
}

/** No POTM, finish or server fields from the client (core/matchGuards.ts guardCreate; firestore.rules matchCreateOk). */
export function matchCreateBase(m: NewMatchDoc) {
  const { startedAt: _s, startedServerAt: _ss, finishedServerAt: _fs, verification: _v, confirmedAt: _ca, ...rest } = m;
  return rest;
}

/** The checked document (participantIds in the order the rules compare), before the start stamps. */
export function matchCreateChecked(m: NewMatchDoc) {
  const rest = matchCreateBase(m);
  return checkMatchFields({ ...rest, participantIds: canonicalParticipants(m) }, { scheduleChanged: true });
}

/** What addDoc receives: a live match carries its start (device ms + server time), plus updatedAt. */
export function matchCreateDoc<T extends ReturnType<typeof matchCreateChecked>>(doc0: T, now: number, serverTime: () => unknown) {
  const live = doc0.status === 'live' ? { startedAt: now, startedServerAt: serverTime() } : {};
  // 1.4.1 (V140-8): no client createdAt (firestore.rules refuse it); matchFrom derives one for older code paths
  return clean({ ...doc0, ...live, updatedAt: now });
}

/**
 * 1.4.4 (QA V143-1): what firebaseBackend.matchFrom puts over a stored match document – the summary replayed from
 * its events and the review flag (core/replay.ts). A document whose rules can't be replayed (corrupt) keeps what is
 * stored and is flagged.
 */
export function replayMatchData(data: Record<string, unknown>): { summary: MatchSummary; resultCheck: ResultCheck | null } | { resultCheck: ResultCheck } {
  try {
    return replayStored(data as Parameters<typeof replayStored>[0]);
  } catch {
    return { resultCheck: 'summary_mismatch' };
  }
}
