import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { Match } from '../core/types';
import { matchDate } from '../core/antifraud';
import { dataLabel, formatDateT, formatWhenT, matchStatusLabel } from '../i18n/format';
import { colors, font } from '../theme';
import { Card, LiveBadge, Row, TeamDot } from './ui';

/** Short date-time for cards (follows the chosen language; English output unchanged). */
export function formatWhen(ts?: number | null) {
  return formatWhenT(ts);
}

export function MatchCard({ m, extra }: { m: Match; extra?: string }) {
  const { t } = useTranslation();
  const s = m.summary;
  const live = m.status === 'live';
  const sched = m.status === 'scheduled';
  const winner = s.winner;
  const line = (side: 'A' | 'B') => {
    const t = side === 'A' ? m.teamA : m.teamB;
    const sets = side === 'A' ? s.setsA : s.setsB;
    const cur = side === 'A' ? s.currentA : s.currentB;
    const won = winner === side;
    return (
      <Row style={{ marginVertical: 3 }}>
        <TeamDot color={t.color} size={12} style={{ marginRight: 8 }} testID={`team-dot-${side}`} />
        <Text style={[font.h3, { flex: 1, color: colors.text, opacity: winner && !won ? 0.55 : 1 }]} numberOfLines={1}>
          {t.name} {live && s.serving === side ? '🏐' : ''}
        </Text>
        {!sched && (
          <>
            <Text style={{ fontSize: 22, fontWeight: '900', width: 32, textAlign: 'right', color: colors.text }}>{sets}</Text>
            {live && <Text style={{ fontSize: 22, fontWeight: '900', width: 44, textAlign: 'right', color: colors.primaryText }}>{cur}</Text>}
          </>
        )}
      </Row>
    );
  };
  return (
    <Card onPress={() => router.push(`/match/${m.id}`)}>
      <Row style={{ marginBottom: 6 }}>
        {live ? <LiveBadge /> : <Text style={[font.small, { color: colors.muted }]}>{sched ? t('matchStatus.scheduled') : m.status === 'finished' ? t('matchStatus.final') : matchStatusLabel(m.status, t)}</Text>}
        <Text style={[font.small, { color: colors.muted, marginLeft: 8, flex: 1 }]} numberOfLines={1} testID={`match-card-when-${m.id}`}>
          {sched
            ? formatWhen(m.scheduledAt)
            : live
              ? dataLabel(m.title, t)
              : /* 1.4.0 (QA V139-9): a finished match card says when it was played (match date, never updatedAt) */
                [formatDateT(matchDate(m)), dataLabel(m.title, t)].filter(Boolean).join(' · ')}
          {extra ? ` · ${extra}` : ''}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Row>
      {line('A')}
      {line('B')}
      {!!s.setScores.length && (
        <Text style={[font.small, { color: colors.muted, marginTop: 4 }]}>{t('common.setsLine', { sets: s.setScores.map((x) => `${x.a}-${x.b}`).join('  ') })}</Text>
      )}
      {m.location && (
        <Row style={{ marginTop: 6 }}>
          <Ionicons name="location" size={14} color={colors.muted} />
          <Text style={[font.small, { color: colors.muted, marginLeft: 4 }]} numberOfLines={1}>
            {m.location.name}
          </Text>
        </Row>
      )}
    </Card>
  );
}

/** Home "Live now" carousel card (design-spec §8 01): 272 wide, LIVE badge, team rows, venue + Watch. */
export function LiveMatchCard({ m, width = 272 }: { m: Match; width?: number }) {
  const { t } = useTranslation();
  const s = m.summary;
  const row = (side: 'A' | 'B') => {
    const tm = side === 'A' ? m.teamA : m.teamB;
    const trailing = side === 'A' ? s.currentA < s.currentB : s.currentB < s.currentA;
    return (
      <Row style={{ marginVertical: 4 }}>
        <TeamDot color={tm.color} size={10} style={{ marginRight: 8 }} testID={`team-dot-${side}`} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: trailing ? colors.muted : colors.text }} numberOfLines={1}>
          {tm.name}
        </Text>
        {s.serving === side && <Ionicons name="tennisball" size={13} color={colors.primaryText} style={{ marginRight: 8 }} accessibilityLabel={t('score.serving')} />}
        <Text style={{ width: 22, textAlign: 'right', fontSize: 14, fontWeight: '700', color: colors.muted }}>{side === 'A' ? s.setsA : s.setsB}</Text>
        <Text style={{ width: 36, textAlign: 'right', fontSize: 20, fontWeight: '800', color: trailing ? colors.muted : colors.text, fontVariant: ['tabular-nums'] }}>
          {side === 'A' ? s.currentA : s.currentB}
        </Text>
      </Row>
    );
  };
  return (
    <Card onPress={() => router.push(`/match/${m.id}`)} style={{ width, marginBottom: 0, marginRight: 12 }}>
      <Row style={{ marginBottom: 6 }}>
        <LiveBadge />
        <Text style={[font.small, { color: colors.muted, marginLeft: 8, flex: 1 }]} numberOfLines={1}>
          {/* R136-20: an untitled match reads "Team A vs Team B · Set 1", not "· Set 1" */}
          {`${dataLabel(m.title, t) || `${m.teamA.name} ${t('common.vs')} ${m.teamB.name}`} · ${t('home.setN', { n: s.setScores.length + 1 })}`}
        </Text>
      </Row>
      {row('A')}
      {row('B')}
      <Row style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.hairline }}>
        <Ionicons name="location-outline" size={14} color={colors.muted} />
        <Text style={[font.small, { color: colors.muted, marginLeft: 4, flex: 1 }]} numberOfLines={1}>
          {m.location?.name ?? ''}
        </Text>
        <Text style={{ color: colors.primaryText, fontWeight: '700', fontSize: 14 }}>{t('home.watch')}</Text>
      </Row>
    </Card>
  );
}
