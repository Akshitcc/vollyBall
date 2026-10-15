import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppMap from '../../components/maps/AppMap';
import type { MapMarker } from '../../components/maps/types';
import { formatWhen } from '../../components/MatchCard';
import { Card, Chip, Empty, LiveBadge, Row, Button } from '../../components/ui';
import { fitRadiusKm, nearby, type GeoPoint } from '../../core/geo';
import type { Court, Match, Tournament } from '../../core/types';
import { backend } from '../../services/backend';
import { DEFAULT_AREA_KEY, DEFAULT_CENTER, getLocationFix } from '../../services/location';
import { useWatch } from '../../state/hooks';
import { formatDateRangeT, formatDistanceT as formatDistance, surfaceLabel } from '../../i18n/format';
import { colors, font } from '../../theme';
import { ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/** QA 1.2.1 minor: a fade at the right edge of a sideways chip row, so a cut chip reads as "more". */
function EdgeFade({ testID }: { testID?: string }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={['rgba(245,247,250,0)', colors.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 14, width: 32 }}
      testID={testID}
    />
  );
}

type Item =
  | { kind: 'match'; id: string; location: GeoPoint & { name: string }; m: Match }
  | { kind: 'tournament'; id: string; location: GeoPoint & { name: string }; t: Tournament }
  | { kind: 'court'; id: string; location: GeoPoint & { name: string }; c: Court };

const ANYWHERE = 3000;
const RADII = [5, 25, 100, ANYWHERE];

export default function MapScreen() {
  const { t } = useTranslation();
  const [center, setCenter] = useState<GeoPoint>(DEFAULT_CENTER);
  /** 'pending' while asking, 'on' with a real fix, 'off' when denied, unavailable or timed out. */
  const [locStatus, setLocStatus] = useState<'pending' | 'on' | 'off'>('pending');
  const located = locStatus === 'on';
  /** Blocked for good (browser site settings / phone Settings): say how to allow it (fix re-test 213 #3). */
  const [blocked, setBlocked] = useState(false);
  /** Linking.openSettings() rejected (fix re-test 214 #3): say how to get there by hand instead. */
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [radius, setRadius] = useState(25);
  const [matches, setMatches] = useState<Match[]>([]);
  const [courts, setCourts] = useState<Court[]>([]);
  const [filter, setFilter] = useState<'all' | 'match' | 'tournament' | 'court'>('all');
  const tournaments = useWatch<Tournament[]>((cb) => backend.watchTournaments(cb), []) ?? [];

  const alive = useRef(true);
  const asks = useRef(0);
  /** Asks for the location (as the screen opens, and again from "Try again"); the latest ask wins. */
  const locate = useCallback(() => {
    const mine = ++asks.current;
    setLocStatus('pending');
    setSettingsFailed(false);
    getLocationFix({ prompt: true }).then(({ point: p, blocked: b }) => {
      if (!alive.current || mine !== asks.current) return;
      if (p) setCenter(p);
      setLocStatus(p ? 'on' : 'off');
      setBlocked(!p && b);
    });
  }, []);
  useEffect(() => {
    // The Nearby map is the one screen that asks for location as it opens (it's what it is for).
    alive.current = true;
    locate();
    return () => {
      alive.current = false;
    };
  }, [locate]);

  useFocusEffect(
    useCallback(() => {
      backend.listPublicMatches().then(setMatches);
      backend.listCourts().then(setCourts);
    }, []),
  );

  const items: Item[] = [
    ...matches.filter((m) => m.location).map((m) => ({ kind: 'match' as const, id: m.id, location: m.location!, m })),
    ...tournaments.filter((t) => t.status !== 'finished').map((t) => ({ kind: 'tournament' as const, id: t.id, location: t.location, t })),
    ...courts.map((c) => ({ kind: 'court' as const, id: c.id, location: c.location, c })),
  ].filter((i) => filter === 'all' || i.kind === filter);
  const near = nearby(items, center, radius);

  const markers: MapMarker[] = near.map((i) => ({
    id: `${i.kind}:${i.id}`,
    lat: i.location.lat,
    lng: i.location.lng,
    title: i.kind === 'match' ? `${i.m.teamA.name} ${t('common.vs')} ${i.m.teamB.name}` : i.kind === 'tournament' ? `🏆 ${i.t.name}` : `🏐 ${i.c.name}`,
    subtitle: i.location.name,
    color: i.kind === 'match' ? (i.m.status === 'live' ? colors.live : colors.primary) : i.kind === 'tournament' ? colors.mapTournament : colors.success,
  }));

  // 5/25/100 km: everything listed is within the radius, so inside the square map. "Anywhere":
  // the map zooms out to fit every listed place (fix re-test 210 #4) instead of staying at 200 km.
  const mapRadius = radius >= ANYWHERE ? fitRadiusKm(center, near.map((i) => i.location)) : radius;

  const openSettings = () => {
    setSettingsFailed(false);
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(Linking.openSettings());
    } catch (e) {
      p = Promise.reject(e);
    }
    p.catch(() => {
      if (alive.current) setSettingsFailed(true);
    });
  };

  const open = (key: string) => {
    const [kind, id] = key.split(':');
    if (kind === 'match') router.push(`/match/${id}`);
    if (kind === 'tournament') router.push(`/tournament/${id}`);
    if (kind === 'court') router.push(`/court/${id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* min 200 = the map's own minimum: on short windows (e.g. 708 px at 200% zoom, ~363 px tall)
          45% was less, and the map spilled over the "Play nearby" header. */}
      <View style={{ height: '45%', minHeight: 200 }} testID="nearby-map-box">
        {/* "You are here" (drawn, and kept clear of other dots) only with a real location (fix re-test 211). */}
        <AppMap center={center} radiusKm={mapRadius} markers={markers} onMarkerPress={open} showsUser={located} userLocation={located ? center : null} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Row style={{ marginBottom: 4 }}>
          <Text style={[font.h2, { flex: 1 }]}>{t('map.playNearby')}</Text>
          <Ionicons name={located ? 'navigate' : 'navigate-outline'} size={18} color={colors.muted} />
          <Text testID="location-status" style={{ color: colors.muted, fontWeight: '700', marginLeft: 4 }}>
            {locStatus === 'on' ? t('map.yourLocation') : locStatus === 'pending' ? t('map.locating') : t('map.locationOff', { area: t(DEFAULT_AREA_KEY) })}
          </Text>
        </Row>
        {locStatus === 'off' && (
          <Pressable onPress={locate} accessibilityRole="button" testID="location-retry" hitSlop={8} style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 }}>
            <Text style={{ color: colors.primaryText, fontWeight: '800', textDecorationLine: 'underline' }}>{t('map.tryAgain')}</Text>
          </Pressable>
        )}
        {locStatus === 'off' && blocked && (
          <View testID="location-blocked" style={{ backgroundColor: colors.warnBg, borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{Platform.OS === 'web' ? t('map.locationBlockedWeb') : t('map.locationBlockedApp')}</Text>
            {Platform.OS !== 'web' && (
              <Pressable onPress={openSettings} accessibilityRole="button" testID="location-open-settings" style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.ink }}>
                <Text style={{ color: 'white', fontWeight: '800' }}>{t('map.openSettings')}</Text>
              </Pressable>
            )}
            {Platform.OS !== 'web' && settingsFailed && (
              <Text testID="location-settings-failed" accessibilityRole="alert" style={{ color: colors.text, marginTop: 6 }}>
                {t('map.openSettingsFailed')}
              </Text>
            )}
          </View>
        )}
        {/* Two rows that each scroll sideways instead of the last chips being cut off at the screen
            edge (QA 216 minor). F135-5: no scrollbar (it covered the chips on web); the edge fade
            shows there is more, and they still scroll by drag, wheel/trackpad and keyboard. */}
        <View style={{ position: 'relative' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 36 }} testID="map-radius-chips">
          {RADII.map((r) => (
            <Chip key={r} label={r >= ANYWHERE ? t('map.anywhere') : t('map.km', { n: r })} active={radius === r} onPress={() => setRadius(r)} />
          ))}
        </ScrollView>
        <EdgeFade testID="map-radius-fade" />
        </View>
        <View style={{ position: 'relative' }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 36 }} testID="map-filter-chips">
          {(['all', 'match', 'tournament', 'court'] as const).map((f) => (
            <Chip key={f} label={{ all: t('map.all'), match: t('map.games'), tournament: t('map.tournaments'), court: t('map.courts') }[f]} active={filter === f} onPress={() => setFilter(f)} color={colors.primary} />
          ))}
        </ScrollView>
        <EdgeFade testID="map-filter-fade" />
        </View>
        {near.length === 0 && <Empty icon="map-outline" title={t('map.nothing')} text={t('map.nothingText')} />}
        {near.map((i) => (
          <Card key={i.kind + i.id} onPress={() => open(`${i.kind}:${i.id}`)}>
            <Row>
              {i.kind === 'match' && i.m.status === 'live' ? <LiveBadge /> : <Text style={{ fontSize: 18, color: colors.text }}>{i.kind === 'match' ? '🏐' : i.kind === 'tournament' ? '🏆' : '📍'}</Text>}
              <Text style={[font.h3, { marginLeft: 8, flex: 1 }]} numberOfLines={1}>
                {i.kind === 'match' ? `${i.m.teamA.name} ${t('common.vs')} ${i.m.teamB.name}` : i.kind === 'tournament' ? i.t.name : i.c.name}
              </Text>
              <Text style={{ fontWeight: '900', color: colors.text }}>{formatDistance(i.distanceKm)}</Text>
            </Row>
            <Text style={{ color: colors.muted, fontWeight: '600', marginTop: 4 }} numberOfLines={1}>
              {i.location.name}
              {i.kind === 'match' && i.m.status === 'scheduled' ? ` · ${formatWhen(i.m.scheduledAt)}` : ''}
              {i.kind === 'tournament' ? ` · ${formatDateRangeT(i.t.startDate, i.t.endDate)}` : ''}
              {i.kind === 'court' ? ` · ${surfaceLabel(i.c.surface, t)}` : ''}
            </Text>
          </Card>
        ))}
        <Button title={t('map.addCourt')} icon="add" variant="secondary" onPress={() => router.push('/court/new')} />
      </ScrollView>
    </SafeAreaView>
  );
}
