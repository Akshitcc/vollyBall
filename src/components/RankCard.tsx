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
import { colors, elevation, overlineFor, radius, type } from '../theme';
import { ProgressBar } from './Hero';
import { PressableScale } from './PressableScale';

function Cell({ label, value, testID }: { label: string; value: string | number; testID?: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.value} testID={testID} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.label} numberOfLines={2}>
        {label}
      </Text>
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
  return (
    <View style={[s.card, style]} testID="rank-card">
      <View style={s.head}>
        <View style={s.medal}>
          <Ionicons name="trophy" size={26} color={colors.ink} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }} testID="profile-rank" accessible accessibilityLabel={full}>
          <Text style={[overlineFor(currentLanguage()), { color: colors.primaryText }]} numberOfLines={1}>
            {t('rankings.yourRankAll')}
          </Text>
          {ranked ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={[type.rank, { color: colors.text }]} testID="profile-rank-num">{`#${row!.rank}`}</Text>
              <Text style={[type.bodyStrong, { color: colors.muted, marginLeft: 6 }]}>{t('rankings.ofTotal', { total: rankings!.total })}</Text>
            </View>
          ) : (
            <Text style={[type.h2, { color: colors.text, marginTop: 2 }]}>{full}</Text>
          )}
        </View>
      </View>
      {rankings && (
        <View style={{ marginTop: 12 }}>
          <ProgressBar value={progress} thumb testID="profile-rank-progress" />
          <View style={{ flexDirection: 'row', marginTop: 6 }}>
            {/* 1.4.16 (QA V1415-3): the points never shrink or wrap ("53" / "pts" on two lines); the "to pass" text takes the rest */}
            <Text style={[type.caption, { color: colors.muted, flexShrink: 0, marginRight: 8 }]} numberOfLines={1} testID="profile-rank-pts">{t('home.rankPts', { pts: row?.rankingPoints ?? 0 })}</Text>
            <Text style={[type.caption, { color: colors.primaryText, fontWeight: '700', flex: 1, textAlign: 'right' }]} testID={ranked ? undefined : 'profile-rank-hint'} numberOfLines={2}>
              {ranked ? (ahead ? toPassText(t, row!.rankingPoints, ahead) /* 1.4.15 (QA V1414-4): one helper with the Home card */ : t('rankings.top')) : t('rankings.playMore', { count: left })}
            </Text>
          </View>
        </View>
      )}
      <View style={s.grid}>
        <Cell label={t('rankings.rankingPoints')} value={row?.rankingPoints ?? 0} testID="profile-rank-points" />
        <Cell label={t('rankings.winPct')} value={row?.matches ? `${row.winPct}%` : '–'} testID="profile-rank-winpct" />
        <Cell label={t('rankings.potm')} value={row?.potm ?? 0} testID="profile-potm-count" />
        <Cell label={t('rankings.matches')} value={row?.matches ?? 0} testID="profile-rank-matches" />
        <Cell label={t('rankings.wins')} value={row?.wins ?? 0} testID="profile-rank-wins" />
        <Cell label={t('rankings.points')} value={row?.points ?? 0} testID="profile-rank-credited" />
      </View>
      <PressableScale onPress={() => router.push('/rankings')} style={s.link} testID="open-rankings" accessibilityRole="button">
        <Text style={s.linkText}>{t('rankings.seeAll')}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.primaryText} />
      </PressableScale>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.md, padding: 14, marginTop: 8, ...elevation.e3 },
  head: { flexDirection: 'row', alignItems: 'center' },
  medal: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -4 },
  cell: { width: '33.33%', padding: 4 },
  value: { color: colors.text, fontSize: 20, fontWeight: '800', backgroundColor: colors.bg, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingHorizontal: 10, paddingTop: 10 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', backgroundColor: colors.bg, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, paddingHorizontal: 10, paddingBottom: 10, minHeight: 42 },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 6 },
  linkText: { color: colors.primaryText, fontWeight: '700', fontSize: 15, marginRight: 4 },
});
