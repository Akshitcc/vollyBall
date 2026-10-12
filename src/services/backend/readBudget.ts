/**
 * 1.4.6 (QA V145-8) / 1.4.7 (QA V146-4): the one hard read budget of a Firebase-mode call (rankings, wallet, the admin
 * list and the unknown-player profile lookups). Pure – no Firebase imports – so it is unit-tested directly.
 */
import type { DocumentData } from 'firebase/firestore';

/**
 * 1.4.5 (QA V144-5) / 1.4.6 (QA V145-8): how much rankings / wallet / admin review read (Firebase has no server-side
 * aggregation, and a client-written result aggregate can't be trusted – the rules can't check it against the events).
 *
 * One HARD byte budget (MAX_BYTES) per rankings / wallet / review call, shared by the tiers in priority order:
 *   own matches (wallet only) → approved → captain-confirmed (the matches that can count) → the rest of the finished.
 * Each tier gets at most its SHARE of what is left (the last tier gets the rest), so an early tier can never starve
 * the next one to zero again (1.4.5's approved query ran after 500 finished docs and got no budget). A page is never
 * bigger than (bytes left) / WORST_DOC_BYTES documents, so the bytes read can't pass the budget even if every
 * document in a page is the largest the rules allow (≤ 3000 events × ≤ 140 B + rosters / lineups / records ≈ 470 KB,
 * rounded up to 512 KiB). docs/qa/RELEASE-1.4.6.md has the worst case.
 */
export const RANKING_READ = Object.freeze({
  PAGE: 50,
  MAX_OWN: 200,
  MAX_APPROVED: 200,
  MAX_CONFIRMED: 300,
  MAX_FINISHED: 500,
  /** 1.4.7 (QA V146-4): each of the admin list's 3 extra queries (abandoned review / abandoned / abandon requests) */
  MAX_FLAGGED: 100,
  MAX_BYTES: 24 * 1024 * 1024,
  WORST_DOC_BYTES: 512 * 1024,
  /** 1.4.7 (QA V146-4): profile lookups (unknown players) come out of the same budget; a reserve the match tiers leave */
  PROFILE_RESERVE: 2 * 1024 * 1024,
  WORST_PROFILE_BYTES: 16 * 1024,
  PROFILE_CHUNK: 30,
  /** fraction of the bytes LEFT a tier may use (the finished tier: all of it) */
  SHARE: Object.freeze({ own: 0.25, flagged: 0.15, approved: 0.3, confirmed: 0.6, finished: 1 }),
});
export type RankingTier = keyof typeof RANKING_READ.SHARE;
/** Size of a match document as read (JSON length of its data – events dominate). */
export const approxDocBytes = (d: DocumentData): number => {
  try {
    return 64 + JSON.stringify(d).length;
  } catch {
    return RANKING_READ.WORST_DOC_BYTES;
  }
};
/** How many documents the next page may ask for so that even worst-case documents stay within `bytesLeft` (0 = stop). */
export const pageSizeFor = (bytesLeft: number, have: number, max: number): number =>
  Math.max(0, Math.min(RANKING_READ.PAGE, max - have, Math.floor(bytesLeft / RANKING_READ.WORST_DOC_BYTES)));
export type ReadBudget = { bytes: number };
/** A fresh budget for one call: the match tiers may use all but the profile reserve. */
export const newReadBudget = (): ReadBudget => ({ bytes: RANKING_READ.MAX_BYTES });
/**
 * 1.4.6 (QA V145-8) / 1.4.7 (QA V146-4): pages of one query within the tier's share of the budget (minus the profile
 * reserve); never asks for more than the bytes left can hold. Errors propagate – a refused read or a missing index
 * fails the call instead of silently shrinking the list.
 */
export async function pagedReads<D>(
  fetchPage: (n: number, last: D | null) => Promise<D[]>,
  size: (d: D) => number,
  max: number,
  budget: ReadBudget,
  tier: RankingTier,
): Promise<D[]> {
  const out: D[] = [];
  let mine = Math.floor(Math.max(0, budget.bytes - RANKING_READ.PROFILE_RESERVE) * RANKING_READ.SHARE[tier]);
  let last: D | null = null;
  for (;;) {
    const n = pageSizeFor(mine, out.length, max);
    if (n === 0) break;
    const page = await fetchPage(n, last);
    for (const d of page) {
      out.push(d);
      const b = size(d);
      mine -= b;
      budget.bytes -= b;
    }
    if (page.length < n) break;
    last = page[page.length - 1];
  }
  return out;
}
/**
 * 1.4.7 (QA V146-4): profile lookups in chunks of PROFILE_CHUNK, each only while the budget left still holds a chunk
 * of worst-case profiles. Returns the ids found and the ids that could not be checked within the budget (errors
 * propagate).
 */
export async function budgetedProfiles(
  ids: string[],
  fetchChunk: (ids: string[]) => Promise<{ id: string; bytes: number }[]>,
  budget: ReadBudget,
): Promise<{ found: Set<string>; unchecked: string[] }> {
  const found = new Set<string>();
  const unchecked: string[] = [];
  for (let i = 0; i < ids.length; i += RANKING_READ.PROFILE_CHUNK) {
    const part = ids.slice(i, i + RANKING_READ.PROFILE_CHUNK);
    if (budget.bytes < part.length * RANKING_READ.WORST_PROFILE_BYTES) {
      unchecked.push(...ids.slice(i));
      break;
    }
    for (const p of await fetchChunk(part)) {
      found.add(p.id);
      budget.bytes -= p.bytes;
    }
  }
  return { found, unchecked };
}

