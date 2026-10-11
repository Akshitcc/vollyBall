/**
 * Player of the Match: the badge (match summary, match-over dialog) and the scorer's picker
 * (auto-picked with src/core/potm.ts, override before confirming).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickPlayerOfMatch, potmLines, potmProblem } from '../core/potm';
import type { Match } from '../core/types';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { colors } from '../theme';
import { Avatar, Button } from './ui';

/** QA C130-3: 0-point players are disabled in the picker when anyone was credited a point. */
export const potmZeroBlocked = (lines: readonly { points: number }[]) => lines.some((l) => l.points > 0);

const playersOf = (m: Match) => [...m.teamA.players.map((p) => ({ ...p, color: m.teamA.color })), ...m.teamB.players.map((p) => ({ ...p, color: m.teamB.color }))];

export function PotmBadge({ match, compact }: { match: Match; compact?: boolean }) {
  const { t } = useTranslation();
  const id = match.playerOfMatchId;
  const p = id ? playersOf(match).find((x) => x.id === id) : null;
  const pts = useMemo(() => (id ? potmLines(match).find((l) => l.playerId === id)?.points ?? 0 : 0), [match, id]);
  // 1.3.9 (V138-10): say how this Player of the Match was decided (auto-pick rule, or the scorer's choice)
  const auto = useMemo(() => (id ? pickPlayerOfMatch(match) : null), [match, id]);
  if (!id || !p) return null;
  // (no auto-pick = nobody was credited a point: no rule to show)
  const basis = auto === null ? null : auto === id ? t('potm.basisAuto') : t('potm.basisScorer');
  return (
    <View style={[s.badge, compact && { marginVertical: 6 }]} testID="potm-badge" accessible accessibilityLabel={`${t('potm.title')}: ${p.name}${basis ? `. ${basis}` : ''}`}>
      <View style={s.star}>
        <Ionicons name="star" size={18} color={colors.ink} />
      </View>
      <Avatar name={p.name} uri={p.photoURL} size={36} color={p.color} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        {/* 1.3.9 (V138-12): the label wraps instead of being cut ("PLAYER OF THE MAT…") */}
        <Text style={s.badgeLabel} numberOfLines={2} testID="potm-label">
          {t('potm.title')}
        </Text>
        <Text style={s.badgeName} numberOfLines={1}>
          {p.name}
        </Text>
        {basis ? (
          <Text style={s.badgeBasis} testID="potm-basis">
            {basis}
          </Text>
        ) : null}
      </View>
      <Text style={s.badgePts} numberOfLines={1}>
        {t('potm.points', { count: pts })}
      </Text>
    </View>
  );
}

/**
 * The scorer's choice when the match finishes. Shows nothing for others, once confirmed (the badge
 * instead), or after the 24 h window.
 */
export function PotmPicker({ match, uid, onDark }: { match: Match; uid: string; onDark?: boolean }) {
  const { t } = useTranslation();
  const lines = useMemo(() => potmLines(match), [match]);
  const auto = useMemo(() => pickPlayerOfMatch(match), [match]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (match.playerOfMatchId) return <PotmBadge match={match} />;
  const pick = chosen ?? auto;
  // potmProblem with a valid player tells whether this user may choose now at all.
  const anyPlayer = lines[0]?.playerId;
  if (!anyPlayer || potmProblem(match, uid, anyPlayer)) return null;
  const players = playersOf(match);
  const byId = new Map(players.map((p) => [p.id, p]));
  const pts = new Map(lines.map((l) => [l.playerId, l.points]));
  // QA C130-3: a player with no credited points can't be Player of the Match, unless nobody was
  // credited at all (then the scorer still chooses freely, see core/potm.ts).
  const zeroBlocked = potmZeroBlocked(lines);
  const confirm = async () => {
    if (!pick) return;
    setSaving(true);
    setError(null);
    try {
      await backend.setPlayerOfMatch(match.id, pick);
    } catch (e) {
      setError(translateError(e, t));
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={[s.picker, onDark && { backgroundColor: colors.surface }]} testID="potm-picker">
      <Text style={s.pickerTitle}>
        <Ionicons name="star" size={16} color={colors.primaryText} /> {t('potm.title')}
      </Text>
      <Text style={s.note} testID="potm-auto-note">
        {auto ? t('potm.autoNote', { name: byId.get(auto)?.name ?? '', count: pts.get(auto) ?? 0 }) : t('potm.noAuto')}
      </Text>
      <Text style={s.zeroHint} testID="potm-rule">
        <Ionicons name="information-circle-outline" size={13} color={colors.muted} /> {t('potm.rule')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
        {lines.map((l) => {
          const p = byId.get(l.playerId)!;
          const on = pick === l.playerId;
          const off = zeroBlocked && l.points === 0;
          return (
            <Pressable
              key={l.playerId}
              testID={`potm-pick-${l.playerId}`}
              onPress={() => !off && setChosen(l.playerId)}
              disabled={off}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: off }}
              accessibilityLabel={`${p.name}, ${t('potm.points', { count: l.points })}`}
              accessibilityHint={off ? t('potm.zeroHint') : undefined}
              style={[s.player, on && s.playerOn, off && s.playerOff]}
            >
              <Avatar name={p.name} uri={p.photoURL} size={40} color={p.color} />
              <Text style={s.playerName} numberOfLines={1}>
                {p.name.split(' ')[0]}
              </Text>
              <Text style={s.playerPts} numberOfLines={1}>
                {t('potm.points', { count: l.points })}
              </Text>
              {l.playerId === auto && <Text style={s.autoTag}>{t('potm.auto')}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
      {zeroBlocked && lines.some((l) => l.points === 0) && (
        <Text style={s.zeroHint} testID="potm-zero-hint">
          <Ionicons name="information-circle-outline" size={13} color={colors.muted} /> {t('potm.zeroHint')}
        </Text>
      )}
      {error && (
        <Text style={s.error} testID="potm-error">
          {error}
        </Text>
      )}
      <Button
        title={pick ? t('potm.confirm', { name: byId.get(pick)?.name.split(' ')[0] ?? '' }) : t('potm.choose')}
        icon="star"
        onPress={confirm}
        loading={saving}
        disabled={!pick}
        disabledHint={t('potm.choose')}
        testID="potm-confirm"
      />
    </View>
  );
}

const s = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.warnBg, borderColor: colors.primaryText, borderWidth: 2, borderRadius: 16, padding: 10, marginVertical: 8 },
  star: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  badgeLabel: { fontSize: 12, fontWeight: '900', color: colors.primaryText, textTransform: 'uppercase' },
  badgeName: { fontSize: 17, fontWeight: '900', color: colors.ink },
  badgePts: { fontSize: 13, fontWeight: '800', color: colors.ink, marginLeft: 6 },
  badgeBasis: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: 2 },
  picker: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 12, marginVertical: 8, backgroundColor: colors.white },
  pickerTitle: { fontSize: 17, fontWeight: '900', color: colors.ink },
  note: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: 4 },
  player: { width: 76, alignItems: 'center', padding: 6, marginRight: 6, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  playerOff: { opacity: 0.4 },
  zeroHint: { fontSize: 12, color: colors.muted, marginBottom: 6 },
  playerOn: { borderColor: colors.primaryText, backgroundColor: colors.selectedBg },
  playerName: { fontSize: 13, fontWeight: '800', color: colors.ink, marginTop: 4 },
  playerPts: { fontSize: 11, fontWeight: '700', color: colors.muted },
  autoTag: { fontSize: 10, fontWeight: '900', color: colors.primaryText, marginTop: 2 },
  error: { color: colors.danger, fontWeight: '700', marginBottom: 6 },
});
