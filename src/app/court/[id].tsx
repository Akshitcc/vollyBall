import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import AppMap from '../../components/maps/AppMap';
import { Button, Card, Empty, H2, Loading, P } from '../../components/ui';
import { formatCoords } from '../../services/location';
import type { Court } from '../../core/types';
import { backend } from '../../services/backend';
import { formatDateT, surfaceLabel } from '../../i18n/format';
import { colors, font } from '../../theme';

/** A court from the Nearby map (fix re-test 204 #3: court pins used to open nothing). */
export default function CourtPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const [court, setCourt] = useState<Court | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    backend
      .listCourts()
      .then((cs) => alive && setCourt(cs.find((c) => c.id === id) ?? null))
      .catch(() => alive && setCourt(null));
    return () => {
      alive = false;
    };
  }, [id]);
  if (court === undefined) return <Loading />;
  if (court === null) return <Empty icon="location-outline" title={t('court.notFound')} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: court.name }} />
      <View style={{ height: 220 }} testID="court-map">
        <AppMap center={court.location} radiusKm={2} markers={[{ id: court.id, title: court.name, lat: court.location.lat, lng: court.location.lng, color: colors.success }]} />
      </View>
      <View style={{ padding: 14 }}>
        <H2>{court.name}</H2>
        <Card>
          <Text style={font.h3} testID="court-surface">
            {surfaceLabel(court.surface, t)}
          </Text>
          <P muted>{court.location.name}</P>
          <P muted>{formatCoords(court.location)}</P>
          <P muted>{t('court.addedOn', { date: formatDateT(court.createdAt) })}</P>
        </Card>
        <Button title={t('court.startMatch')} icon="play" onPress={() => router.push(`/match/new?courtId=${court.id}` as never)} testID="court-start-match" />
      </View>
    </View>
  );
}
