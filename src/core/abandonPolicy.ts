/**
 * 1.4.5 (QA V144-1): what happens when the scorer abandons a match after the first rally. NOT DECIDED YET – Akshit
 * hasn't chosen, so all modes are built and tested and this build ships a neutral INTERIM default ('review', interim,
 * pending decision). This is the ONE switch: the API server and the demo import it; firestore.rules repeat it in
 * abandonPolicy() (rules-tests check that they agree; `node scripts/gen-abandon-policy.js` rewrites the rules line).
 *  - 'review' (INTERIM default of 1.4.5, pending decision): every abandon after the first rally goes to admin review with
 *    who abandoned it and the score then; whether the scorer's side was behind is shown as INFORMATION only. The admin
 *    reinstates the match (live again, or finished when the replay has a winner) or confirms the abandon.
 *  - 'flag' (option a): the same review, and an abandon while the scorer's side is behind is marked "abandoned while
 *    behind" as the reason for the review.
 *  - 'consent' (option b): after the first rally the scorer only REQUESTS the abandon. The opposing captain (both
 *    captains when the scorer plays on neither side) must agree, or an admin decides. Until then the match stays live
 *    and scoring is paused.
 * Every mode: never on a match that is or was won (wasWon latch), and not by the scorer once the log ever reached the
 * shortest possible win (maxEvents >= minWinEvents – an admin decides those). Before the first rally: abandoned
 * directly. The opposing captain can report any abandoned match to admin review (core/abandon.ts reportAbandon).
 * docs/qa/RELEASE-1.4.5.md "Switching the abandon policy".
 */
export type AbandonPolicy = 'review' | 'flag' | 'consent';
export const ABANDON_POLICY: AbandonPolicy = 'review';
export const ABANDON_POLICIES: readonly AbandonPolicy[] = ['review', 'flag', 'consent'];
