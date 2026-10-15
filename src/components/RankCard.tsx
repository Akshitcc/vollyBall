/**
 * Profile rank card (design-spec §8 03): white card overlapping the hero, medal tile, "YOUR RANK ·
 * ALL PLAYERS", big #N of M, progress to the next rank, KPI tiles and "See rankings".
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { toPassText } from './rankText';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { MIN_RANKED_MATCHES, type RankingRow } from '../core/ranking';
import { currentLanguage } from '../i18n';
import type { RankingsResult } from '../services/backend/types';
import { colors, elevation, overlineFor, radius, type, themed } from '../theme';
import { ProgressBar } from './Hero';
import { PressableScale } from './PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import { Body, Over, Sticker, useKit } from './DNKit';

/** 1.4.22 stat tile (spec v2 *-05): Day = sticker tile (optional Ball / mint fill); Night = surface tile, display numeral. */
export function Cell({ label, value, testID, fill, accent }: { label: string; value: string | number; testID?: string; fill?: string; accent?: boolean }) {
  const k = useKit();
  return (
    <View style={s.cell}>
      <Sticker fill={k.day ? fill : k.t.surface} radius={16} shadow={3} inner={{ padding: 12, minHeight: 74, justifyContent: 'space-between' }}>
        <Text style={[{ color: !k.day && accent ? k.t.primary : k.t.text, fontSize: k.day ? 22 : 30, lineHeight: k.day ? 26 : 30 }, k.f.display]} testID={testID} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        <Body size={12} muted={!k.day} bold={k.day} numberOfLines={2}>{label}</Body>
      </Sticker>
    </View>
  );
}

export function RankCard({ rankings, style }: { rankings: RankingsResult | null | undefined; style?: object }) {
  const { t } = useTranslation();
  const row: RankingRow | null = rankings?.me ?? null;
  const min = rankings?.minMatches ?? MIN_RANKED_MATCHES;
  const left = Math.max(0, min - (row?.matches ?? 0));
  const ranked = !!rankings && !!row?.rank;
  const ahead = ranked && row!.rank! > 1 ? rankings!.ranked[row!.rank! - 2] : null;
  const progress = ranked ? (ahead ? row!.rankingPoints / Math.max(1, ahead.rankingPoints) : 1) : (row?.matches ?? 0) / Math.max(1, min);
  const full =
    rankings === undefined
      ? t('rankings.loading')
      : rankings === null
        ? t('rankings.unavailable')
        : ranked
          ? t('rankings.rankOf', { n: row!.rank, total: rankings.total })
          : t('rankings.unranked');
  const k = useKit();
  // 1.4.22 (spec v2 *-05): Day = white sticker card with a tilted orange "#N RANK" disc; Night = violet→surface
  // gradient card with a big Volt "#N".
  const head = (
    <>
      <View style={s.head}>
        {k.day ? (
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: k.t.primary, borderWidth: 2, borderColor: k.t.outline, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] }} testID="rank-disc">
            <Text style={[{ fontSize: 10, color: k.t.onPrimary, letterSpacing: 1 }, k.f.bold]}>{t('dn.rankWord')}</Text>
            <Text style={[{ fontSize: 26, color: k.t.onPrimary, lineHeight: 28 }, k.f.display]} numberOfLines={1} adjustsFontSizeToFit testID={ranked ? 'profile-rank-num' : undefined}>{ranked ? `#${row!.rank}` : '–'}</Text>
          </View>
        ) : (
          <Text style={[{ fontSize: 56, lineHeight: 56, color: k.t.primary, minWidth: 64 }, k.f.score]} testID={ranked ? 'profile-rank-num' : 'rank-disc'}>{ranked ? `#${row!.rank}` : '–'}</Text>
        )}
        <View style={{ flex: 1, marginLeft: 12 }} testID="profile-rank" accessible accessibilityLabel={full}>
          <Over numberOfLines={1}>{ranked ? `${t('rankings.yourRankAll')} · ${t('rankings.ofTotal', { total: rankings!.total })}` : t('rankings.yourRankAll')}</Over>
          {ranked ? null : <Body bold size={17} style={{ marginTop: 2 }}>{full}</Body>}
          {rankings && (
            <View style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <Body bold size={13} style={{ flexShrink: 0, marginRight: 6 }} numberOfLines={1} testID="profile-rank-pts">{t('home.rankPts', { pts: row?.rankingPoints ?? 0 })}</Body>
                <Body size={13} muted style={{ flexShrink: 0, marginRight: 4 }}>·</Body>
                <Body size={13} muted style={{ flex: 1 }} testID={ranked ? undefined : 'profile-rank-hint'} numberOfLines={2}>
                  {ranked ? (ahead ? toPassText(t, row!.rankingPoints, ahead) /* 1.4.15 (QA V1414-4): one helper with the Home card */ : t('rankings.top')) : t('rankings.playMore', { count: left })}
                </Body>
              </View>
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={progress} thumb testID="profile-rank-progress" />
              </View>
            </View>
          )}
        </View>
      </View>
    </>
  );
  return (
    <View style={style} testID="rank-card">
      {k.day ? (
        <Sticker style={{ marginTop: 8 }} inner={{ padding: 14 }}>{head}</Sticker>
      ) : (
        <View style={{ marginTop: 8, borderRadius: k.t.radius.card, overflow: 'hidden', borderWidth: 1, borderColor: k.t.outline, padding: 14 }}>
          <LinearGradient colors={[k.t.hero[0], k.t.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          {head}
        </View>
      )}
      <View style={s.grid}>
        <Cell label={t('rankings.rankingPoints')} value={row?.rankingPoints ?? 0} testID="profile-rank-points" />
        <Cell label={t('rankings.winPct')} value={row?.matches ? `${row.winPct}%` : '–'} testID="profile-rank-winpct" fill={k.t.success} />
        <Cell label={t('rankings.potm')} value={row?.potm ?? 0} testID="profile-potm-count" fill={k.t.accent} accent />
        <Cell label={t('rankings.matches')} value={row?.matches ?? 0} testID="profile-rank-matches" />
        <Cell label={t('rankings.wins')} value={row?.wins ?? 0} testID="profile-rank-wins" />
        <Cell label={t('rankings.points')} value={row?.points ?? 0} testID="profile-rank-credited" />
      </View>
      <PressableScale onPress={() => router.push('/rankings')} style={s.link} testID="open-rankings" accessibilityRole="button">
        <Text style={[s.linkText, { color: k.day ? k.t.teamAText : k.t.primary }, k.f.bold]}>{t('rankings.seeAll')}</Text>
        <Ionicons name="chevron-forward" size={18} color={k.day ? k.t.teamAText : k.t.primary} />
      </PressableScale>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginTop: 8, ...elevation.e3 },
  head: { flexDirection: 'row', alignItems: 'center' },
  medal: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -4 },
  cell: { width: '33.33%', padding: 4, paddingBottom: 6 },
  value: { color: colors.text, fontSize: 20, fontWeight: '800', backgroundColor: colors.bg, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 10, paddingTop: 10 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', backgroundColor: colors.bg, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, paddingHorizontal: 10, paddingBottom: 10, minHeight: 42 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 6 },
  linkText: { color: colors.primaryText, fontWeight: '700', fontSize: 15, marginRight: 4 },
}));
