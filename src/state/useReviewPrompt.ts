/**
 * 1.3.7: asks for a Play review at a happy moment on the match detail screen (never on the live
 * scoring screen): the match is finished and the user's side won, or they are Player of the Match.
 * Eligibility (>= 3 completed matches, once per 60 days per user) is in core/reviewPrompt.ts.
 *
 * 1.3.8 (QA V137-4): only right after the match finishes (seen finishing on this screen, or opened within
 * a few minutes of the finish) or right after the user confirms the result – opening an old won match
 * never asks. The 60-day check uses the server clock when the backend knows it (API: Date header;
 * Firebase 1.3.9: serverTimestamp()s in users/{uid}/private/review), else the phone's (demo only).
 */
import { useCallback, useEffect, useRef } from 'react';
import { reviewMomentFor, reviewTriggered } from '../core/reviewPrompt';
import type { Match } from '../core/types';
import { backend } from '../services/backend';
import { maybeAskForReview } from '../services/review';

/** Server time when the backend has it (API: from the responses' Date header), else the phone clock. */
export function reviewNow(): number {
  const s = typeof backend.serverNow === 'function' ? backend.serverNow() : null;
  return typeof s === 'number' && Number.isFinite(s) ? s : Date.now();
}

/** 1.3.9 (V137-4): Firebase keeps the review clock on the server (serverTimestamp); API/demo: undefined. */
export function serverClockFor(uid: string) {
  const b = backend;
  if (typeof b.reviewClock !== 'function' || typeof b.markReviewAsked !== 'function') return undefined;
  return { read: () => b.reviewClock!(uid), mark: () => b.markReviewAsked!(uid) };
}

export function useReviewPrompt(m: Match | null | undefined, uid: string): { onConfirmed: () => void } {
  const asked = useRef(false);
  const opened = useRef<{ id: string; finished: boolean; potm: boolean } | null>(null);
  if (m && opened.current?.id !== m.id) opened.current = { id: m.id, finished: m.status === 'finished', potm: !!m.playerOfMatchId };
  const moment = m ? reviewMomentFor(m, uid) : null;
  const latest = useRef(m);
  latest.current = m;

  const ask = useCallback(
    (match: Match) => {
      const mo = reviewMomentFor(match, uid);
      if (!mo || asked.current) return () => undefined;
      let off: (() => void) | undefined;
      // a short pause so the result is seen first
      const timer = setTimeout(() => {
        const u = backend.watchMyMatches(uid, (mine) => {
          off?.();
          off = undefined;
          if (asked.current) return;
          asked.current = true;
          const completed = mine.filter((x) => x.status === 'finished').length;
          void maybeAskForReview({ uid, moment: mo, completedMatches: completed, liveScoring: false, now: reviewNow(), serverClock: serverClockFor(uid) });
        });
        if (asked.current) u(); // answered synchronously (demo)
        else off = u;
      }, 1500);
      return () => {
        clearTimeout(timer);
        off?.();
      };
    },
    [uid],
  );

  useEffect(() => {
    if (!m || !moment || asked.current || !opened.current) return;
    const now = reviewNow();
    const go = reviewTriggered({
      openedFinished: opened.current.finished,
      openedWithPotm: opened.current.potm,
      finished: m.status === 'finished',
      hasPotm: !!m.playerOfMatchId,
      finishedAt: m.finishedServerAt ?? m.finishedAt ?? null,
      now,
    });
    if (!go) return;
    return ask(m);
  }, [m?.id, m?.status, m?.playerOfMatchId, moment, uid, ask]); // eslint-disable-line react-hooks/exhaustive-deps

  const onConfirmed = useCallback(() => {
    const cur = latest.current;
    if (cur) ask(cur); // the user just confirmed the result: a happy moment if their side won / they're POTM
  }, [ask]);
  return { onConfirmed };
}
