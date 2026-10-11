/** Admin only (1.3.0): completed matches flagged for review; approve (counts) or void (never counts). */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EmptyCard } from '../components/Hero';
import { Button, Card } from '../components/ui';
import { matchFlags, ownMatchReview } from '../core/antifraud';
import type { Match } from '../core/types';
import { formatWhenT, translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { useAuth } from '../state/AuthContext';
import { colors, type } from '../theme';
import { flagText } from '../components/ResultBadge';

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
      {error ? <Text style={[type.body, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      {list && list.length === 0 ? <EmptyCard icon="checkmark-done-outline" title={t('verify.noFlagged')} /> : null}
      {(list ?? []).map((m) => {
        // 1.3.5 (QA E134-4): the card says what is being approved: score, when, how long, why.
        const sm = m.summary;
        const mins = m.startedServerAt != null && m.finishedServerAt != null ? Math.max(0, Math.round((m.finishedServerAt - m.startedServerAt) / 60000)) : null;
        const own = ownMatchReview(m, user?.uid ?? ''); // E134-2: never your own match
        return (
          <Card key={m.id} style={{ marginBottom: 12 }} onPress={() => router.push(`/match/${m.id}`)}>
            <Text style={[type.h3, { color: colors.text }]} testID={`flagged-${m.id}`}>{m.teamA.name} {t('common.vs')} {m.teamB.name}</Text>
            {sm ? (
              <Text style={[type.body, { color: colors.text, fontWeight: '800', marginTop: 4 }]} testID={`flagged-score-${m.id}`}>
                {t('verify.reviewScore', { a: sm.setsA, b: sm.setsB, sets: sm.setScores.map((x) => `${x.a}-${x.b}`).join('  ') })}
              </Text>
            ) : null}
            <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`flagged-when-${m.id}`}>
              {[formatWhenT(m.finishedAt ?? m.updatedAt), mins != null ? t('verify.reviewMinutes', { count: mins }) : null].filter(Boolean).join(' · ')}
            </Text>
            <Text style={[type.caption, { color: colors.danger, marginTop: 2, fontWeight: '700' }]} testID={`flagged-why-${m.id}`}>{flagText(matchFlags(m), t)}</Text>
            {own ? (
              <Text style={[type.caption, { color: colors.muted, marginTop: 10 }]} testID={`own-${m.id}`}>{t('errors.codes.own_match')}</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Button title={t('verify.approve')} onPress={() => void review(m.id, 'approve')} style={{ flex: 1 }} testID={`approve-${m.id}`} />
                <Button title={t('verify.void')} variant="danger" onPress={() => void review(m.id, 'void')} style={{ flex: 1 }} testID={`void-${m.id}`} />
              </View>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
