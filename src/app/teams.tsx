/** My teams (home quick action "My teams"): every team I'm in, plus "+ New team". */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { EmptyCard, card } from '../components/Hero';
import { PressableScale } from '../components/PressableScale';
import { Avatar } from '../components/ui';
import type { Team } from '../core/types';
import { backend } from '../services/backend';
import { useMe } from '../state/AuthContext';
import { useWatch } from '../state/hooks';
import { colors, type } from '../theme';

export default function TeamsScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const teams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="teams-screen">
      <PressableScale onPress={() => router.push('/team/new')} accessibilityRole="button" testID="teams-new" style={[card, { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: colors.tint }]}>
        <Ionicons name="add-circle" size={24} color={colors.primaryText} />
        <Text style={[type.h3, { color: colors.primaryText, marginLeft: 8 }]}>{t('profile.newTeam')}</Text>
      </PressableScale>
      {teams !== undefined && teams.length === 0 && <EmptyCard icon="people-outline" title={t('profile.noTeam')} text={t('profile.noTeamText')} />}
      {(teams ?? []).map((tm) => (
        <PressableScale key={tm.id} onPress={() => router.push(`/team/${tm.id}`)} accessibilityRole="button" testID={`teams-${tm.id}`} style={[card, { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }]}>
          <Avatar name={tm.name} size={44} color={tm.color} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
              {tm.name}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('profile.players', { count: tm.memberIds.length })}
              {tm.captainId === me.id ? t('profile.captainSuffix') : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </PressableScale>
      ))}
    </ScrollView>
  );
}
