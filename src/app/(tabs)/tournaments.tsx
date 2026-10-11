import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Button, Card, Empty, H1, P, Row, Screen, breakWords } from '../../components/ui';
import type { Tournament } from '../../core/types';
import { backend } from '../../services/backend';
import { useWatch } from '../../state/hooks';
import { formatDateRangeT, tournamentStatusLabel } from '../../i18n/format';
import { tournamentDisplayStatus } from '../../core/tournament';
import { colors, font } from '../../theme';

export default function Tournaments() {
  const { t: tr } = useTranslation();
  const list = useWatch<Tournament[]>((cb) => backend.watchTournaments(cb), []);
  return (
    <Screen>
      <H1>{tr('tournaments.title')}</H1>
      <P muted style={{ marginBottom: 8 }}>{tr('tournaments.intro')}</P>
      <Button title={tr('tournaments.create')} icon="trophy" onPress={() => router.push('/tournament/new')} />
      {list && list.length === 0 && <Empty icon="trophy-outline" title={tr('tournaments.none')} />}
      {(list ?? []).map((t) => (
        <Card key={t.id} onPress={() => router.push(`/tournament/${t.id}`)}>
          <Row>
            <Text style={{ fontSize: 26, marginRight: 10 }}>🏆</Text>
            {/* QA V5: long names wrap to two lines and end with "…" inside the card. */}
            <Text style={[font.h3, { flex: 1, minWidth: 0 }, breakWords]} numberOfLines={2} ellipsizeMode="tail" testID={`tournament-name-${t.id}`}>
              {t.name}
            </Text>
            <Text testID={`tournament-status-${t.id}`} style={{ fontWeight: '900', color: tournamentDisplayStatus(t) === 'running' ? colors.danger : colors.muted, fontSize: 12, marginLeft: 8, flexShrink: 0 }}>{tournamentStatusLabel(tournamentDisplayStatus(t), tr)}</Text>
          </Row>
          <Row style={{ marginTop: 6 }}>
            <Ionicons name="calendar" size={14} color={colors.muted} />
            <Text style={{ color: colors.muted, fontWeight: '600', marginLeft: 4 }}>
              {formatDateRangeT(t.startDate, t.endDate)} · {tr(t.format === 'knockout' ? 'formats.knockout' : 'formats.league')} · {tr('tournaments.teams', { count: t.teams.length })}
            </Text>
          </Row>
          <Row style={{ marginTop: 4 }}>
            <Ionicons name="location" size={14} color={colors.muted} />
            <Text style={{ color: colors.muted, fontWeight: '600', marginLeft: 4 }} numberOfLines={1}>
              {t.location.name}
            </Text>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
