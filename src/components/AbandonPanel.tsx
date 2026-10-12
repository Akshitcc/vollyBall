/**
 * 1.4.5 (QA V144-1/2/3): what a match page and the admin review show about an abandon (src/core/abandon.ts):
 *  - a pending request (consent policy): who asked, scoring paused; Agree / Decline for a captain who must agree;
 *  - an abandoned match: who abandoned it and the replayed score then, the side that was behind (information in the
 *    interim 'review' policy, the reason in 'flag'), the review state; "Report to admin" for the opposing captain;
 *  - for an admin who isn't part of the match: the resolutions that apply (reinstate / confirm abandon / reopen / mark
 *    abandoned / void / reject request).
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { ABANDON_POLICY, abandonedAt, type AbandonedAt, abandonFacts, abandonPending, finishedWithoutWinner, reportersOf, requiredAgreers, resolveActions, type ResolveAction } from '../core/abandon';
import { ownMatchReview, sideOfPlayer, verificationStatus } from '../core/antifraud';
import type { Match } from '../core/types';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { confirmAsk } from '../services/dialogs';
import { colors, type } from '../theme';
import { Button, Card } from './ui';

type T = (k: string, o?: Record<string, unknown>) => string;
// 1.4.6 (QA V145-4): the score and "behind" are replayed from the events up to the record, never read from it.
// 1.4.7 (QA V146-7): the current set's points are THE score, the sets come separately and labelled ("2–8 in set 1 ·
// sets 0–0"); 1.4.6 printed the sets as the score and the points as "sets".
/**
 * 1.4.8 (QA V147-3): ONE abandon score everywhere – the card line, the panel, the admin confirm and the scorer's
 * dialog – from the replayed events (core abandonedAt): "at 2–8 in set 1 · sets 0–0", between sets "after set 1 ·
 * sets 1–0 (25‑3)" (1.4.7's panel said "at 0–0 in set 2" and left out the finished sets).
 */
export interface AbandonScoreParts { between: boolean; a: number; b: number; set: number; sa: number; sb: number; done: string }
export function abandonScoreParts(at: AbandonedAt): AbandonScoreParts {
  // a non-breaking hyphen keeps "25‑15" on one line at 360 px
  const done = at.done.length ? ` (${at.done.map((x) => `${x.a}\u2011${x.b}`).join(', ')})` : '';
  const between = at.current.a + at.current.b === 0;
  return { between, a: at.current.a, b: at.current.b, set: between ? at.setNo - 1 : at.setNo, sa: at.setsA, sb: at.setsB, done };
}
/** The score part ("at 2–8 in set 1 · sets 0–0" / "after set 1 · sets 1–0 (25‑3)"). */
export function abandonScoreOf(at: AbandonedAt, t: T): string {
  if (!at.sets.length) return t('verify.scoreAt', { a: 0, b: 0, set: 1, sa: 0, sb: 0, done: '' });
  const p = abandonScoreParts(at);
  return t(p.between ? 'verify.scoreAfterSet' : 'verify.scoreAt', p as unknown as Record<string, unknown>);
}
export const scoreText = (m: Match, t: T): string => abandonScoreOf(abandonedAt(m), t);
/** 1.4.7 (QA V146-7): the whole line, e.g. "Abandoned at 2–8 in set 1 · sets 0–0" / "… · sets 1–0 (25‑20)". */
export function abandonedLineOf(at: AbandonedAt, t: T): string {
  if (!at.sets.length) return t('verify.abandonedAtNoRally');
  const p = abandonScoreParts(at) as unknown as Record<string, unknown> & AbandonScoreParts;
  return p.between ? t('verify.abandonedAfterSet', p) : t('verify.abandonedAt', p);
}
export function abandonedLine(m: Match, t: T): string {
  return abandonedLineOf(abandonedAt(m), t);
}
/** 1.4.6 (QA V145-14): why an abandoned match is on the list – who abandoned it (and behind), the report. */
export function abandonWhy(m: Match, t: T, nameOf: (uid: string) => string | undefined): string {
  const a = m.abandon;
  const parts: string[] = [];
  if (!a) parts.push(m.events.length ? t('verify.whyLegacy') : t('verify.abandonedAtNoRally'));
  else if (a.mode === 'admin') parts.push(t('verify.whyAdmin'));
  else {
    const name = (a.by && nameOf(a.by)) || a.by || '';
    const side = a.by ? sideOfPlayer(m, a.by) : null;
    const team = side === 'A' ? m.teamA.name : side === 'B' ? m.teamB.name : null;
    parts.push(abandonFacts(m)?.behind && team ? t('verify.whyAbandonedBehind', { name, team }) : t('verify.whyAbandoned', { name }));
  }
  if (a?.reportedBy) parts.push(t('verify.whyReported', { name: nameOf(a.reportedBy) ?? a.reportedBy }));
  return parts.join(' · ');
}

export function AbandonPanel({ match: m, meId, isAdmin, nameOf, onChanged, testID = 'abandon-panel' }: {
  match: Match;
  meId: string;
  isAdmin: boolean;
  nameOf: (uid: string) => string | undefined;
  onChanged?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const run = async (f: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setMsg({ text: done });
      onChanged?.();
    } catch (e) {
      setMsg({ text: translateError(e, t), error: true });
    } finally {
      setBusy(false);
    }
  };
  const pending = abandonPending(m);
  const winnerless = finishedWithoutWinner(m);
  const adminActions: (ResolveAction | 'void')[] = isAdmin && !ownMatchReview(m, meId) ? [...resolveActions(m)] : [];
  if (winnerless && adminActions.length && verificationStatus(m) !== 'approved') adminActions.push('void');
  const canReport = reportersOf(m).includes(meId);
  const need = pending && m.abandonRequest ? requiredAgreers(m, m.abandonRequest) : [];
  const canAnswer = pending && need.includes(meId) && !m.abandonRequest!.agreedBy.includes(meId);
  if (!pending && m.status !== 'abandoned' && !winnerless && !adminActions.length) return null;
  const a = m.abandon;
  const by = a?.by ?? (m.status === 'abandoned' ? m.scorerId : null);
  const byName = by ? nameOf(by) ?? by : '';
  const behindSide = abandonFacts(m)?.behind && by ? sideOfPlayer(m, by) : null;
  const behindTeam = behindSide ? (behindSide === 'A' ? m.teamA.name : m.teamB.name) : null;
  const title = (k: ResolveAction | 'void') => t(`abandon.actions.${k}`);
  const act = (k: ResolveAction | 'void') => () => {
    void (async () => {
      // 1.4.6 (QA V145-16): reinstate and confirm-abandon get a second step too, saying what happens
      const ask = k === 'reinstate' || k === 'confirm_abandon' || k === 'void' ? t(`abandon.confirm.${k}`, { score: scoreText(m, t) }) : title(k) + '?';
      if (k !== 'reopen' && k !== 'reject_request' && !(await confirmAsk(ask, { title: title(k), confirmLabel: title(k), cancelLabel: t('common.cancel') }))) return;
      await run(() => (k === 'void' ? backend.reviewMatch(m.id, 'void') : backend.resolveMatch(m.id, k)), t('abandon.doneToast'));
    })();
  };
  return (
    <Card style={{ marginBottom: 12 }}>
      <View testID={testID}>
        {pending ? (
          <Text style={[type.body, { color: colors.text, fontWeight: '800' }]} testID={`${testID}-request`}>
            {t('abandon.requestBy', { name: nameOf(m.abandonRequest!.by) ?? m.abandonRequest!.by })}
          </Text>
        ) : null}
        {m.status === 'abandoned' ? (
          <>
            <Text style={[type.body, { color: colors.text, fontWeight: '800' }]} testID={`${testID}-by`}>
              {t('abandon.abandonedBy', { name: byName, score: scoreText(m, t) })}
            </Text>
            {behindTeam ? (
              <Text style={[type.caption, { color: (a?.mode ?? ABANDON_POLICY) === 'flag' ? colors.danger : colors.muted, marginTop: 2 }]} testID={`${testID}-behind`}>
                {(a?.mode ?? ABANDON_POLICY) === 'flag' ? t('abandon.behindReason', { team: behindTeam }) : t('abandon.sideBehind', { team: behindTeam })}
              </Text>
            ) : null}
            {a?.review === 'pending' || (!a && m.events.length > 0) ? (
              <Text style={[type.caption, { color: colors.text, marginTop: 2, fontWeight: '700' }]} testID={`${testID}-pending`}>{t('abandon.reviewPending')}</Text>
            ) : a?.review === 'confirmed' ? (
              <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`${testID}-confirmed`}>{t('abandon.reviewConfirmed')}</Text>
            ) : null}
            {a?.reportedBy ? <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`${testID}-reported`}>{t('abandon.reportedBy', { name: nameOf(a.reportedBy) ?? a.reportedBy })}</Text> : null}
          </>
        ) : null}
        {winnerless ? <Text style={[type.body, { color: colors.danger, fontWeight: '800' }]} testID={`${testID}-winnerless`}>{t('abandon.winnerless')}</Text> : null}
        {canAnswer ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title={t('abandon.agree')} variant="danger" loading={busy} style={{ flex: 1 }} testID="abandon-agree" onPress={() => void run(() => backend.answerAbandonRequest(m.id, 'agree'), t('abandon.doneToast'))} />
            <Button title={t('abandon.decline')} variant="secondary" loading={busy} style={{ flex: 1 }} testID="abandon-decline" onPress={() => void run(() => backend.answerAbandonRequest(m.id, 'decline'), t('abandon.doneToast'))} />
          </View>
        ) : null}
        {canReport ? (
          <Button
            title={t('abandon.report')}
            icon="flag-outline"
            variant="secondary"
            loading={busy}
            style={{ marginTop: 10 }}
            testID="abandon-report"
            onPress={() =>
              void (async () => {
                if (await confirmAsk(t('abandon.reportConfirm'), { title: t('abandon.report'), confirmLabel: t('abandon.report'), cancelLabel: t('common.cancel') }))
                  await run(() => backend.reportAbandon(m.id), t('abandon.reportedToast'));
              })()
            }
          />
        ) : null}
        {adminActions.length ? (
          <View style={{ marginTop: 10, gap: 8 }} testID={`${testID}-admin`}>
            <Text style={[type.caption, { color: colors.muted, fontWeight: '800' }]}>{t('abandon.adminTitle')}</Text>
            {adminActions.map((k) => (
              <Button key={k} title={title(k)} variant={k === 'abandon' || k === 'void' || k === 'confirm_abandon' ? 'danger' : 'primary'} loading={busy} onPress={act(k)} testID={`resolve-${k}-${m.id}`} />
            ))}
          </View>
        ) : null}
        {msg ? (
          <Text style={[type.caption, { color: msg.error ? colors.danger : colors.successStrong, marginTop: 6 }]} accessibilityRole={msg.error ? 'alert' : undefined} testID={`${testID}-msg`}>
            {msg.text}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
