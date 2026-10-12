/**
 * 1.3.0 result verification UI: the state badge (awaiting POTM / awaiting the other captain /
 * confirmed / flagged / approved / voided), the opposing captain's confirm-or-reject panel and the
 * admin's approve/void buttons. All decisions use src/core/antifraud.ts, like every backend.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { ADMIN_APPROVAL, ANTI_FRAUD, captainVerdict, confirmProblem, expectedConfirmer, matchFlags, resultState, verificationStatus, type FraudFlag, type ResultState } from '../core/antifraud';
import type { Match } from '../core/types';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { confirmAsk } from '../services/dialogs';
import { colors, radius, type } from '../theme';
import { Button } from './ui';

export function flagText(flags: readonly FraudFlag[], t: TFunction): string {
  return t('verify.flagReasons', { reasons: flags.map((f) => t(`verify.${f}`, { min: ANTI_FRAUD.MIN_MATCH_MINUTES })).join(', ') });
}

const LOOK: Record<Exclude<ResultState, 'not_finished' | 'abandoned'>, { icon: keyof typeof Ionicons.glyphMap; bg: string; fg: string }> = {
  awaiting_potm: { icon: 'star-outline', bg: colors.tint, fg: colors.text },
  awaiting_confirmation: { icon: 'hourglass-outline', bg: colors.tint, fg: colors.text },
  confirmed: { icon: 'checkmark-circle', bg: colors.successBg, fg: colors.successStrong },
  approved: { icon: 'shield-checkmark', bg: colors.successBg, fg: colors.successStrong },
  flagged: { icon: 'flag', bg: colors.lossBg, fg: colors.lossText },
  voided: { icon: 'close-circle', bg: colors.lossBg, fg: colors.lossText },
  // 1.3.7 (F135-1): flag cleared by an admin, still waiting for / rejected by the opposing captain
  approved_awaiting_confirmation: { icon: 'hourglass-outline', bg: colors.tint, fg: colors.text },
  approved_rejected: { icon: 'close-circle', bg: colors.lossBg, fg: colors.lossText },
};

export function ResultBadge({ match }: { match: Match }) {
  const { t } = useTranslation();
  const state = resultState(match);
  if (state === 'not_finished' || state === 'abandoned') return null;
  const look = LOOK[state];
  const flags = state === 'flagged' ? matchFlags(match) : [];
  return (
    <View style={[s.badge, { backgroundColor: look.bg }]} accessible accessibilityRole="text" testID={`result-${state}`}>
      <Ionicons name={look.icon} size={18} color={look.fg} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: look.fg, fontWeight: '800' }]}>{t(`verify.${state}`)}</Text>
        {flags.length ? <Text style={[type.caption, { color: look.fg, marginTop: 2 }]}>{flagText(flags, t)}</Text> : null}
      </View>
    </View>
  );
}

/** Badge + (for the opposing captain) confirm / reject + (for an admin) approve / void. */
export function ResultPanel({ match, meId, isAdmin, nameOf, onConfirmed }: { match: Match; meId: string; isAdmin: boolean; nameOf: (uid: string) => string | undefined; onConfirmed?: () => void }) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1.3.8 (V137-13): the "Result confirmed" message is shown here, under the badge, instead of a floating
  // toast that covered the stats below.
  const [notice, setNotice] = useState<string | null>(null);
  // 1.3.9 (V138-12): which action the notice is for – after confirming, the badge itself says "Result confirmed
  // by the opposing captain", so the notice is shown only when the badge says something else (e.g. still flagged)
  const [noticeKind, setNoticeKind] = useState<'confirmed' | 'other'>('other');
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);
  const state = resultState(match);
  if (state === 'not_finished' || state === 'abandoned') return null;
  const canConfirm = confirmProblem(match, meId) === null;
  const confirmer = expectedConfirmer(match);
  const run = async (f: () => Promise<void>, ok: string, kind: 'confirmed' | 'other' = 'other') => {
    setBusy(true);
    setError(null);
    try {
      await f();
      setNoticeKind(kind);
      setNotice(ok);
      if (kind === 'confirmed') AccessibilityInfo.announceForAccessibility(ok);
      setRejecting(false);
      return true;
    } catch (e) {
      setError(translateError(e, t));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // 1.3.8: from the stored status (an approved match can now show as 'confirmed')
  // 1.4.1 (QA V140-12): the opposing captain's answer is part of the stored match, so it is shown from the match
  // every time – not only in the 5-second notice after pressing Confirm, which a reload lost. Shown when the badge
  // says something else (a flagged, voided or admin-approved result); 'confirmed' / 'approved_rejected' already say it.
  const verdict = captainVerdict(match);
  const verdictLine = verdict && (state === 'flagged' || state === 'voided' || state === 'approved') ? verdict : null;
  const reviewable = isAdmin && match.playerOfMatchId && !['approved', 'voided'].includes(verificationStatus(match));
  return (
    <View style={{ marginBottom: 10 }} testID="result-panel">
      <ResultBadge match={match} />
      {verdictLine ? (
        <View style={s.notice} accessible testID={`result-verdict-${verdictLine}`}>
          <Ionicons name={verdictLine === 'confirmed' ? 'checkmark-circle' : 'close-circle'} size={16} color={verdictLine === 'confirmed' ? colors.successStrong : colors.lossText} />
          <Text style={[type.body, { color: verdictLine === 'confirmed' ? colors.successStrong : colors.lossText, fontWeight: '700', flex: 1 }]}>
            {verdictLine === 'confirmed' ? t('verify.confirmed') : t('verify.opponentRejected')}
          </Text>
        </View>
      ) : null}
      {notice && !(noticeKind === 'confirmed' && (state === 'confirmed' || verdictLine === 'confirmed')) ? (
        <View style={s.notice} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="result-notice">
          <Ionicons name="checkmark-circle" size={16} color={colors.successStrong} />
          <Text style={[type.body, { color: colors.successStrong, fontWeight: '700', flex: 1 }]}>{notice}</Text>
        </View>
      ) : null}
      {match.captains ? (
        <Text style={[type.caption, { color: colors.muted, marginTop: 6 }]} testID="result-captains">
          {t('verify.captains')}: {nameOf(match.captains.A) ?? '—'} · {nameOf(match.captains.B) ?? '—'}
        </Text>
      ) : null}
      {(state === 'awaiting_confirmation' || state === 'approved_awaiting_confirmation') && !canConfirm && confirmer ? (
        <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{t('verify.waitingFor', { name: nameOf(confirmer) ?? '—' })}</Text>
      ) : null}
      {canConfirm ? (
        <View style={s.panel} testID="confirm-panel">
          <Text style={[type.h3, { color: colors.text }]}>{t('verify.askTitle')}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 4, marginBottom: 10 }]}>{t('verify.askText')}</Text>
          {rejecting ? (
            <>
              <Text style={[type.caption, { color: colors.text, fontWeight: '700' }]} nativeID="reject-reason-label">{t('verify.reason')}</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                maxLength={ANTI_FRAUD.REJECT_REASON_MAX}
                multiline
                style={s.input}
                accessibilityLabel={t('verify.reason')}
                accessibilityLabelledBy="reject-reason-label"
                placeholderTextColor={colors.placeholder}
                testID="reject-reason"
              />
              <Text style={[type.caption, { color: colors.muted, textAlign: 'right' }]}>{reason.length}/{ANTI_FRAUD.REJECT_REASON_MAX}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <Button title={t('verify.cancel')} variant="secondary" onPress={() => setRejecting(false)} style={{ flex: 1 }} />
                <Button title={t('verify.sendReject')} variant="danger" loading={busy} onPress={() => void run(() => backend.rejectResult(match.id, reason), t('verify.rejectedToast'))} style={{ flex: 1 }} testID="reject-send" />
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={t('verify.confirm')} icon="checkmark" loading={busy} onPress={() => void run(() => backend.confirmResult(match.id), t('verify.confirmedToast'), 'confirmed').then((ok) => ok && onConfirmed?.())} style={{ flex: 1 }} testID="confirm-result" />
              <Button title={t('verify.reject')} icon="flag-outline" variant="secondary" onPress={() => setRejecting(true)} style={{ flex: 1 }} testID="reject-result" />
            </View>
          )}
        </View>
      ) : null}
      {reviewable ? (
        <View style={s.panel} testID="admin-panel">
          <Text style={[type.h3, { color: colors.text, marginBottom: 8 }]}>{t('verify.adminTitle')}</Text>
          <AdminReviewButtons
            busy={busy}
            onApprove={() => void run(() => backend.reviewMatch(match.id, 'approve'), t('verify.reviewedToast'))}
            onVoid={() => void run(() => backend.reviewMatch(match.id, 'void'), t('verify.reviewedToast'))}
            approveID="admin-approve"
            voidID="admin-void"
            score={reviewScoreText(match, t)}
          />
        </View>
      ) : null}
      {error ? <Text style={[type.body, { color: colors.danger, marginTop: 6 }]} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  badge: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: radius.md, padding: 12 },
  panel: { backgroundColor: colors.white, borderRadius: radius.md, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, minHeight: 72, padding: 10, color: colors.text, backgroundColor: colors.white, textAlignVertical: 'top', marginTop: 4 },
});

/**
 * 1.3.9 (V138-14): the admin's Approve / Void pair. Short button text ("Approve" / "मंज़ूर करें") with what it
 * does as a subtitle underneath, so nothing clips at 360 px in Hindi. Used on the match screen and in admin-review.
 */
/** 1.4.10 (QA V149-5): the final score as the review card shows it ("2–1 · 25-20  20-25  15-10"), or null. */
export const reviewScoreText = (m: Pick<Match, 'summary'>, t: TFunction): string | null =>
  m.summary ? t('verify.reviewScore', { a: m.summary.setsA, b: m.summary.setsB, sets: m.summary.setScores.map((x) => `${x.a}-${x.b}`).join('  ') }) : null;
export function AdminReviewButtons({ busy, onApprove, onVoid, approveID, voidID, style, score }: { busy?: boolean; onApprove: () => void; onVoid: () => void; approveID: string; voidID: string; style?: StyleProp<ViewStyle>; score?: string | null }) {
  const { t } = useTranslation();
  const approveSub = t(ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN ? 'verify.approveSubCounts' : 'verify.approveSubClears');
  return (
    <View style={[{ flexDirection: 'row', gap: 8 }, style]}>
      <View style={{ flex: 1 }}>
        <Button title={t('verify.approveShort')} loading={busy} onPress={onApprove} testID={approveID} />
        <Text style={[type.caption, { color: colors.muted, marginTop: 4, textAlign: 'center' }]} testID={`${approveID}-sub`}>{approveSub}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {/* 1.4.9 (QA V148-5): Void is final – it asks first, like reinstate (every screen using these buttons) */}
        <Button
          title={t('verify.voidShort')}
          variant="danger"
          loading={busy}
          onPress={() => void confirmAsk(score ? t('verify.voidAskScore', { score }) : t('verify.voidAsk'), { title: t('verify.voidShort'), confirmLabel: t('verify.voidShort'), cancelLabel: t('common.cancel') }).then((ok) => ok && onVoid())}
          testID={voidID}
        />
        <Text style={[type.caption, { color: colors.muted, marginTop: 4, textAlign: 'center' }]} testID={`${voidID}-sub`}>{t('verify.voidSub')}</Text>
      </View>
    </View>
  );
}
