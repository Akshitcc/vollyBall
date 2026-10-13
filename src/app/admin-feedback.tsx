/** 1.3.7 Admin only: feedback sent from Profile > Send feedback (newest first). 1.4.19: + the support inbox (Contact us tickets, status open / replied / closed). */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { EmptyCard } from '../components/Hero';
import { Card, Chip } from '../components/ui';
import { Image } from 'react-native';
import { SUPPORT_STATUSES, type SupportStatus, type SupportTicket } from '../core/support';
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
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (isAdmin) backend.listFeedback().then(setList).catch((e) => setError(translateError(e, t)));
    if (isAdmin) backend.listSupportTickets().then(setTickets).catch((e) => setError(translateError(e, t)));
  }, [isAdmin, t]);
  const setStatus = async (id: string, status: SupportStatus) => {
    try {
      await backend.setSupportTicketStatus(id, status);
      setTickets((l) => (l ?? []).map((x) => (x.id === id ? { ...x, status } : x)));
    } catch (e) {
      setError(translateError(e, t));
    }
  };
  if (!isAdmin) return <EmptyCard icon="lock-closed-outline" title={t('errors.codes.admin_only')} />;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="admin-feedback">
      {error ? <Text style={[type.body, { color: colors.danger }]} accessibilityRole="alert">{error}</Text> : null}
      <Text style={[type.body, { fontWeight: '900', color: colors.text, marginBottom: 8 }]} accessibilityRole="header">{t('support.inbox')}</Text>
      {tickets && tickets.length === 0 ? <Text style={[type.body, { color: colors.muted, marginBottom: 12 }]} testID="support-inbox-empty">{t('support.inboxEmpty')}</Text> : null}
      {(tickets ?? []).map((x) => (
        <Card key={x.id} style={{ marginBottom: 10 }} onPress={() => setOpenId(openId === x.id ? null : x.id)} testID={`ticket-${x.id}`}>
          <Text style={[type.caption, { color: colors.text, fontWeight: '800' }]} numberOfLines={1}>{t('support.from', { name: x.userName ?? x.userId })} · {t(`support.topics.${x.topic}`)}</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID={`ticket-meta-${x.id}`}>{[t(`support.status.${x.status}`), x.appVersion, formatWhenT(x.createdAt)].filter(Boolean).join(' · ')}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 6 }]} selectable numberOfLines={openId === x.id ? undefined : 2}>{x.message}</Text>
          {openId === x.id ? (
            <View testID={`ticket-open-${x.id}`}>
              {x.screenshotUrl ? (
                <Image source={{ uri: x.screenshotUrl }} style={{ width: 120, height: 200, borderRadius: 8, marginTop: 8 }} accessibilityIgnoresInvertColors testID={`ticket-shot-${x.id}`} />
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {SUPPORT_STATUSES.map((st) => (
                  <Chip key={st} label={t(`support.status.${st}`)} active={x.status === st} onPress={() => void setStatus(x.id, st)} testID={`ticket-${x.id}-${st}`} />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ))}
      <Text style={[type.body, { fontWeight: '900', color: colors.text, marginTop: 12, marginBottom: 8 }]} accessibilityRole="header">{t('support.feedbackSection')}</Text>
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
