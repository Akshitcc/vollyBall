/** Admin only (1.3.0): completed matches flagged for review; approve (counts) or void (never counts). */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { EmptyCard } from '../components/Hero';
import { Button, Card } from '../components/ui';
import { matchFlags } from '../core/antifraud';
import type { Match } from '../core/types';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { useAuth } from '../state/AuthContext';
import { colors, type } from '../theme';
import { flagText } from '../components/ResultBadge';

export default function AdminReviewScreen() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
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
      {(list ?? []).map((m) => (
        <Card key={m.id} style={{ marginBottom: 12 }} onPress={() => router.push(`/match/${m.id}`)}>
          <Text style={[type.h3, { color: colors.text }]}>{m.teamA.name} v {m.teamB.name}</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]}>{flagText(matchFlags(m), t)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title={t('verify.approve')} onPress={() => void review(m.id, 'approve')} style={{ flex: 1 }} testID={`approve-${m.id}`} />
            <Button title={t('verify.void')} variant="danger" onPress={() => void review(m.id, 'void')} style={{ flex: 1 }} testID={`void-${m.id}`} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
