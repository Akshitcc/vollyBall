/**
 * Admin only (1.3.0): completed matches flagged for review; approve (counts) or void (never counts).
 * 1.4.5 (QA V144-1/2): also abandoned matches waiting for review, finished matches without a winner and pending
 * abandon requests – those cards carry the resolutions (AbandonPanel) instead of approve / void.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EmptyCard } from '../components/Hero';
import { Button, Card } from '../components/ui';
import { ADMIN_APPROVAL, captainVerdict, matchDate, matchFlags, ownMatchReview } from '../core/antifraud';
import type { Match } from '../core/types';
import { formatWhenZoneT, translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { useAuth } from '../state/AuthContext';
import { colors, type } from '../theme';
import { AdminReviewButtons, flagText, reviewScoreText } from '../components/ResultBadge';
import { AbandonPanel, abandonedLine, abandonWhy } from '../components/AbandonPanel';
import { needsAdminAction } from '../core/abandon';
import { showsVerdictRepair, VerdictRepairCard } from '../components/VerdictRepairCard';

// a player's name from the match's own rosters (the review list has no profiles loaded)
const nameOf = (m: Match, uid: string): string | undefined => [...m.teamA.players, ...m.teamB.players].find((p) => p.id === uid)?.name;

export default function AdminReviewScreen() {
  const { t } = useTranslation();
  const { isAdmin, user } = useAuth();
  const [list, setList] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.listFlagged().then(setList).catch((e) => setError(translateError(e, t)));
  }, [t]);
  useEffect(load, [load]);
  const review = async (id: string, d: 'approve' | 'void') => {
    try {
      await backend.reviewMatch(id, d);
      load();
    } catch (e) {
      setError(translateError(e, t));
    }
  };
  if (!isAdmin) return <EmptyCard icon="lock-closed-outline" title={t('errors.codes.admin_only')} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="admin-review">
      {/* 1.3.7: the other admin tools */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Button title={t('feedback.adminTitle')} icon="chatbox-outline" variant="secondary" onPress={() => router.push('/admin-feedback')} style={{ flex: 1 }} testID="open-admin-feedback" />
        <Button title={t('daily.adminTitle')} icon="bulb-outline" variant="secondary" onPress={() => router.push('/admin-daily')} style={{ flex: 1 }} testID="open-admin-daily" />
      </View>
      {error ? <Text style={[type.body, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      {!ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN ? <Text style={[type.caption, { color: colors.muted, marginBottom: 10 }]} testID="approve-note">{t('verify.approveNote')}</Text> : null}
      {list && list.length === 0 ? <EmptyCard icon="checkmark-done-outline" title={t('verify.noFlagged')} /> : null}
      {(list ?? []).map((m) => {
        // 1.3.5 (QA E134-4): the card says what is being approved: score, when, how long, why.
        const sm = m.summary;
        const mins = m.startedServerAt != null && m.finishedServerAt != null ? Math.max(0, Math.round((m.finishedServerAt - m.startedServerAt) / 60000)) : null;
        const own = ownMatchReview(m, user?.uid ?? ''); // E134-2: never your own match
        return (
          /* 1.4.1 (V140-11): pressable cards are now real buttons on web, and a button can't hold the
             approve/void buttons, so the match opens from its title instead of the whole card */
          <Card key={m.id} style={{ marginBottom: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/match/${m.id}`)} testID={`flagged-open-${m.id}`}>
              <Text style={[type.h3, { color: colors.text }]} testID={`flagged-${m.id}`}>{m.teamA.name} {t('common.vs')} {m.teamB.name} ›</Text>
            </Pressable>
            {m.status === 'abandoned' ? (
              /* 1.4.6 (QA V145-14): an abandoned match has no final – the replayed score where it stopped */
              <Text style={[type.body, { color: colors.text, fontWeight: '800', marginTop: 4 }]} testID={`flagged-score-${m.id}`}>{abandonedLine(m, t)}</Text>
            ) : sm ? (
              <Text style={[type.body, { color: colors.text, fontWeight: '800', marginTop: 4 }]} testID={`flagged-score-${m.id}`}>
                {t('verify.reviewScore', { a: sm.setsA, b: sm.setsB, sets: sm.setScores.map((x) => `${x.a}-${x.b}`).join('  ') })}
              </Text>
            ) : null}
            <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`flagged-when-${m.id}`}>
              {[formatWhenZoneT(matchDate(m)) /* 1.3.9 (V138-11): never updatedAt; 1.4.7 (V146-8): device zone, labelled */, mins != null ? t('verify.reviewMinutes', { count: mins }) : null].filter(Boolean).join(' · ')}
            </Text>
            <Text style={[type.caption, { color: colors.danger, marginTop: 2, fontWeight: '700' }]} testID={`flagged-why-${m.id}`}>{m.status === 'abandoned' ? abandonWhy(m, t, (uid) => nameOf(m, uid)) : flagText(matchFlags(m), t)}</Text>
            {/* 1.3.7 (F135-1): approval clears the flag; the opposing captain's confirmation still decides */}
            {!ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN && !needsAdminAction(m) ? (
              <Text style={[type.caption, { color: colors.text, marginTop: 2, fontWeight: '700' }]} testID={`flagged-captain-${m.id}`}>
                {captainVerdict(m) === 'confirmed' ? t('verify.opponentConfirmed') : captainVerdict(m) === 'rejected' ? t('verify.opponentRejected') : t('verify.waitingOpponent')}
              </Text>
            ) : null}
            {own ? (
              <Text style={[type.caption, { color: colors.muted, marginTop: 10 }]} testID={`own-${m.id}`}>{t('errors.codes.own_match')}</Text>
            ) : showsVerdictRepair(m, user?.uid ?? '', isAdmin) ? (
              /* 1.4.8 (QA V147-2): nobody can confirm – repair first (a valid scorer or confirmer) */
              <View style={{ marginTop: 10 }}>
                <VerdictRepairCard match={m} meId={user?.uid ?? ''} isAdmin={isAdmin} nameOf={(uid) => nameOf(m, uid)} onChanged={load} testID={`verdict-repair-${m.id}`} />
              </View>
            ) : needsAdminAction(m) ? (
              <View style={{ marginTop: 10 }}>
                <AbandonPanel match={m} meId={user?.uid ?? ''} isAdmin={isAdmin} nameOf={(uid) => nameOf(m, uid)} onChanged={load} testID={`abandon-panel-${m.id}`} />
              </View>
            ) : (
              <AdminReviewButtons onApprove={() => void review(m.id, 'approve')} onVoid={() => void review(m.id, 'void')} approveID={`approve-${m.id}`} voidID={`void-${m.id}`} score={reviewScoreText(m, t)} style={{ marginTop: 10 }} />
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
