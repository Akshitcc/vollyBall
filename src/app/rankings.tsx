/**
 * Rankings: top players by ranking points (src/core/ranking.ts – credited points + 10 per win +
 * 25 per Player of the Match, finished matches only, at least 3 matches), your own row highlighted.
 * Redesign (design-spec §8 07): gradient hero with a podium for the top 3, formula line, list rows
 * from #4, and a sticky navy "You" bar while your own row is off-screen.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { toPassText } from '../components/rankText';
import React, { useCallback, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { EmptyCard, Skeleton } from '../components/Hero';
import { PressableScale } from '../components/PressableScale';
import { Avatar } from '../components/ui';
import { MIN_RANKED_MATCHES, RANKING_POINTS_PER_POTM, RANKING_POINTS_PER_WIN, type RankingRow } from '../core/ranking';
import { useMe } from '../state/AuthContext';
import { useRankings } from '../state/useRankings';
import { colors, elevation, gradients, palette, radius, type } from '../theme';

const label = (r: RankingRow, mine: boolean, t: TFunction) =>
  `${r.rank ? `#${r.rank} ` : ''}${r.name ?? ''}${mine ? `, ${t('rankings.you')}` : ''}, ${t('rankings.ptsShort', { count: r.rankingPoints })}`;

function RowView({ r, mine }: { r: RankingRow; mine: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={[s.row, mine && s.mine]} testID={mine ? 'ranking-me' : `ranking-${r.rank ?? 'x'}`} accessible accessibilityLabel={label(r, mine, t)}>
      <Text style={s.pos}>{r.rank ?? '–'}</Text>
      <Avatar name={r.name ?? '?'} uri={r.photoURL} size={36} color={palette.navyMid} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={s.name} numberOfLines={1}>
          {r.name ?? t('common.player')}
          {mine ? ` · ${t('rankings.you')}` : ''}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {t('rankings.rowMeta', { matches: r.matches, wins: r.wins, pct: r.winPct, potm: r.potm })}
        </Text>
      </View>
      <Text style={s.pts} numberOfLines={1}>
        {r.rankingPoints}
      </Text>
    </View>
  );
}

const PODIUM = {
  1: { avatar: 64, block: 72, grad: gradients.gold, ring: palette.gold },
  2: { avatar: 52, block: 52, grad: gradients.silver, ring: palette.silver },
  3: { avatar: 52, block: 40, grad: gradients.bronze, ring: palette.bronze },
} as const;

function PodiumSpot({ r, place, mine }: { r: RankingRow | undefined; place: 1 | 2 | 3; mine: boolean }) {
  const { t } = useTranslation();
  const p = PODIUM[place];
  if (!r) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }} testID={mine ? 'ranking-me' : `ranking-${place}`} accessible accessibilityLabel={label(r, mine, t)}>
      {place === 1 && <Ionicons name="trophy" size={22} color={palette.gold} style={{ marginBottom: 4 }} />}
      <View style={[{ borderRadius: 999, borderWidth: 3, borderColor: p.ring, padding: 2 }, place === 1 && s.goldGlow]}>
        <Avatar name={r.name ?? '?'} uri={r.photoURL} size={p.avatar} color={palette.navyMid} />
      </View>
      <Text style={s.podName} numberOfLines={1}>
        {(r.name ?? t('common.player')).split(' ')[0]}
        {mine ? ` · ${t('rankings.you')}` : ''}
      </Text>
      <Text style={s.podPts}>{t('home.rankPts', { pts: r.rankingPoints })}</Text>
      <LinearGradient colors={p.grad as unknown as [string, string]} style={[s.block, { height: p.block }]}>
        <Text style={s.blockText}>{place}</Text>
      </LinearGradient>
    </View>
  );
}

export default function RankingsScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const r = useRankings(me.id);
  const [meVisible, setMeVisible] = useState(true);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setMeVisible(viewableItems.some((v) => (v.item as RankingRow).playerId === me.id));
  }).current;
  const renderItem = useCallback(({ item }: { item: RankingRow }) => <RowView r={item} mine={item.playerId === me.id} />, [me.id]);
  if (r === undefined)
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }} testID="rankings-loading">
        <Skeleton h={180} r={16} />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={54} r={12} style={{ marginTop: 10 }} />
        ))}
      </View>
    );
  if (r === null) return <EmptyCard icon="cloud-offline-outline" title={t('rankings.unavailable')} />;
  const top = r.ranked.slice(0, 3);
  const rest = r.ranked.slice(3);
  const mineRow = r.me;
  const mineInTop = top.some((x) => x.playerId === me.id);
  const left = Math.max(0, r.minMatches - (mineRow?.matches ?? 0));
  const ahead = mineRow?.rank && mineRow.rank > 1 ? r.ranked[mineRow.rank - 2] : null;
  const showBar = !!mineRow && !mineInTop && (!mineRow.rank || !meVisible || !rest.some((x) => x.playerId === me.id));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: showBar ? 110 : 40 }}
        data={rest}
        keyExtractor={(x) => x.playerId}
        onViewableItemsChanged={onViewable}
        ListHeaderComponent={
          <View>
            {top.length ? (
              <LinearGradient colors={gradients.hero as unknown as [string, string, string]} style={s.hero} testID="podium">
                <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                  <PodiumSpot r={top[1]} place={2} mine={top[1]?.playerId === me.id} />
                  <PodiumSpot r={top[0]} place={1} mine={top[0]?.playerId === me.id} />
                  <PodiumSpot r={top[2]} place={3} mine={top[2]?.playerId === me.id} />
                </View>
              </LinearGradient>
            ) : (
              <View style={{ padding: 16 }}>
                <EmptyCard
                  icon="podium-outline"
                  title={t('rankings.podiumWaiting')}
                  text={t('rankings.podiumWaitingText', { min: r.minMatches ?? MIN_RANKED_MATCHES, count: left })}
                  cta={t('home.startMatch')}
                  onCta={() => router.push('/match/new')}
                  testID="rankings-empty"
                />
              </View>
            )}
            <View style={s.head} testID="rankings-head">
              <Ionicons name="information-circle" size={16} color={colors.primaryText} />
              <Text style={s.formula}>
                {t('rankings.formula', { win: RANKING_POINTS_PER_WIN, potm: RANKING_POINTS_PER_POTM, min: r.minMatches ?? MIN_RANKED_MATCHES })}
              </Text>
            </View>
            <Text style={s.count}>{t('rankings.rankedCount', { count: r.total })}</Text>
          </View>
        }
        renderItem={renderItem}
        ListFooterComponent={
          !mineInTop && !rest.some((x) => x.playerId === me.id) && mineRow ? (
            <View style={{ marginTop: 12, marginHorizontal: 16 }}>
              <Text style={s.footLabel}>{t('rankings.yourNumbers')}</Text>
              <View style={s.listCard}>
                <RowView r={mineRow} mine />
              </View>
            </View>
          ) : null
        }
        CellRendererComponent={({ children, ...p }) => (
          <View {...p} style={[p.style, s.cell]}>
            {children}
          </View>
        )}
      />
      {showBar && mineRow && (
        <View style={s.youBar} testID="rankings-you-bar">
          <Text style={s.youRank}>{mineRow.rank ? `#${mineRow.rank}` : '–'}</Text>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ color: colors.white, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>
              {`${t('rankings.you')} · ${t('home.rankPts', { pts: mineRow.rankingPoints })}`}
            </Text>
            <Text style={{ color: colors.onInkMuted, fontSize: 12 }} numberOfLines={2}>
              {mineRow.rank ? (ahead ? toPassText(t, mineRow.rankingPoints, ahead) /* 1.4.15 (QA V1414-4): one helper with the Home card */ : t('rankings.top')) : t('rankings.playMore', { count: left })}
            </Text>
          </View>
          <PressableScale onPress={() => router.push('/match/new')} accessibilityRole="button" style={s.play} testID="rankings-play">
            <Ionicons name="add" size={18} color={colors.onPrimary} />
            <Text style={{ color: colors.onPrimary, fontWeight: '800' }}>{t('rankings.play')}</Text>
          </PressableScale>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { paddingHorizontal: 12, paddingTop: 16 },
  goldGlow: { shadowColor: palette.gold, shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  podName: { color: colors.white, fontWeight: '800', fontSize: 14, marginTop: 6, maxWidth: '95%' },
  podPts: { color: colors.onInkMuted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  block: { width: '92%', borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', justifyContent: 'center' },
  blockText: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  head: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginTop: 14 },
  formula: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  count: { color: colors.muted, fontSize: 12, fontWeight: '700', marginHorizontal: 16, marginTop: 6, marginBottom: 8 },
  cell: { marginHorizontal: 16, backgroundColor: colors.white },
  listCard: { backgroundColor: colors.white, borderRadius: radius.md, overflow: 'hidden', ...elevation.e1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline, borderLeftWidth: 4, borderLeftColor: 'transparent' },
  mine: { backgroundColor: colors.tint, borderLeftColor: colors.primaryText },
  pos: { width: 30, fontSize: 14, fontWeight: '800', color: colors.muted },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, fontWeight: '500', marginTop: 1 },
  pts: { fontSize: 16, fontWeight: '800', color: colors.text, marginLeft: 8, minWidth: 40, textAlign: 'right' },
  footLabel: { ...type.overline, color: colors.muted, marginBottom: 6 },
  youBar: { position: 'absolute', left: 12, right: 12, bottom: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, borderRadius: 16, padding: 12, ...elevation.e3 },
  youRank: { color: colors.primary, fontSize: 24, fontWeight: '900' },
  play: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primary },
});
