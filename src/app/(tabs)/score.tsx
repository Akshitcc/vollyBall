import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { MatchCard } from '../../components/MatchCard';
import { Button, Card, Empty, H1, H2, P, Screen } from '../../components/ui';
import type { Match } from '../../core/types';
import { backend } from '../../services/backend';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { colors, font } from '../../theme';

export default function ScoreHub() {
  const { t } = useTranslation();
  const me = useMe();
  const mine = useWatch<Match[]>((cb) => backend.watchMyMatches(me.id, cb), [me.id]) ?? [];
  const toScore = mine.filter((m) => m.scorerId === me.id && (m.status === 'live' || m.status === 'scheduled'));
  return (
    <Screen>
      <H1>{t('scoreHub.title')}</H1>
      <P muted style={{ marginBottom: 12 }}>{t('scoreHub.intro')}</P>
      <Card style={{ backgroundColor: colors.ink, borderColor: colors.ink }}>
        <Text style={[font.h2, { color: colors.white }]}>{t('scoreHub.quickStart')}</Text>
        <Text style={{ color: colors.onInkMuted, marginVertical: 8, fontWeight: '600' }}>{t('scoreHub.quickStartText')}</Text>
        <Button title={t('common.newMatch')} icon="add-circle" big onPress={() => router.push('/match/new')} />
      </Card>
      <H2>{t('scoreHub.yourMatches')}</H2>
      {toScore.length ? (
        toScore.map((m) => (
          <View key={m.id}>
            <MatchCard m={m} />
            <Button title={m.status === 'live' ? t('common.continueScoring') : t('common.startScoring')} icon="play" variant="dark" onPress={() => router.push(`/match/${m.id}/score`)} style={{ marginTop: -6, marginBottom: 14 }} />
          </View>
        ))
      ) : (
        <Empty icon="clipboard-outline" title={t('scoreHub.nothing')} text={t('scoreHub.nothingText')} />
      )}
    </Screen>
  );
}
