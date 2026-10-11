/** 1.3.7 Admin only: feedback sent from Profile > Send feedback (newest first). */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { EmptyCard } from '../components/Hero';
import { Card } from '../components/ui';
import { formatWhenT, translateError } from '../i18n/format';
import { backend } from '../services/backend';
import type { FeedbackItem } from '../services/backend/types';
import { useAuth } from '../state/AuthContext';
import { colors, type } from '../theme';

export default function AdminFeedbackScreen() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [list, setList] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isAdmin) backend.listFeedback().then(setList).catch((e) => setError(translateError(e, t)));
  }, [isAdmin, t]);
  if (!isAdmin) return <EmptyCard icon="lock-closed-outline" title={t('errors.codes.admin_only')} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="admin-feedback">
      {error ? <Text style={[type.body, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      {list && list.length === 0 ? <EmptyCard icon="chatbox-outline" title={t('feedback.none')} /> : null}
      {(list ?? []).map((f) => (
        <Card key={f.id} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={t('feedback.starN', { count: f.stars })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons key={n} name={n <= f.stars ? 'star' : 'star-outline'} size={16} color={n <= f.stars ? '#F5A623' : colors.muted} />
            ))}
            <Text style={[type.caption, { color: colors.text, marginLeft: 8, flex: 1, fontWeight: '700' }]} numberOfLines={1}>
              {f.userName ?? f.userId}
            </Text>
          </View>
          {/* 1.3.8 (V137-13): version and time on their own line, wrapping – never cut off */}
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`feedback-meta-${f.id}`}>
            {[f.appVersion, formatWhenT(f.createdAt)].filter(Boolean).join(' · ')}
          </Text>
          {f.text ? (
            <Text style={[type.body, { color: colors.text, marginTop: 6 }]} selectable testID={`feedback-${f.id}`}>
              {f.text}
            </Text>
          ) : null}
        </Card>
      ))}
    </ScrollView>
  );
}
