/**
 * Live scoring building blocks (design-spec §8 "02 Live scoring"):
 *  - TeamHalf: the whole team half is the tap target (≈164×288 dp), team-colour gradient, set pips,
 *    104 dp tabular score that pops with a floating "+1", SERVING pill, timeout chip, "+" hint;
 *  - CourtCard: one court for both teams (names on 30 dp chips, server badge, Sub link) instead of
 *    the small lineup boxes inside the halves (Tester 1.2.0: clipped edges, crowding "TAP TO SCORE");
 *  - RallyTicker: the last rally and the last 4 rally dots.
 * Reduce Motion (OS / prefers-reduced-motion) turns the pop, +1 and press scale off.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { courtGrid, type Slot } from '../core/rotation';
import type { Side } from '../core/scoring';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { letterSpacing } from '../i18n/format';
import { colors, elevation, onColor, palette, radius, servePill, teamGradient, teamInk, teamRing, type } from '../theme';
import { firstName } from './MiniCourt';

export interface TeamHalfProps {
  side: Side;
  name: string;
  color: string;
  score: number;
  setsWon: number;
  setsToWin: number;
  serving: boolean;
  /** 'set' | 'match' point for this team, or null. */
  point: 'set' | 'match' | null;
  timeoutsLeft: number;
  /** "Who scored" is open: smaller digits, no footer (the halves stay tappable). */
  compact: boolean;
  /** Before the first rally: show the "TAP TO SCORE" caption. */
  showHint: boolean;
  onPoint: () => void;
  onTimeout: () => void;
  height: number;
}

export function TeamHalf(p: TeamHalfProps) {
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const ink = teamInk(p.color);
  const pill = servePill(p.color);
  const ring = teamRing(p.color);
  const press = useSharedValue(1);
  const pop = useSharedValue(1);
  const plusY = useSharedValue(0);
  const plusO = useSharedValue(0);
  const last = useRef(p.score);
  useEffect(() => {
    const up = p.score > last.current;
    last.current = p.score;
    if (reduce || !up) return;
    pop.value = withSequence(withTiming(1.12, { duration: 90 }), withSpring(1, { damping: 12, stiffness: 260, mass: 0.8 }));
    plusO.value = withSequence(withTiming(1, { duration: 60 }), withDelay(120, withTiming(0, { duration: 330 })));
    plusY.value = 0;
    plusY.value = withTiming(-24, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [p.score, reduce, pop, plusO, plusY]);
  const halfStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const scoreStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: plusO.value, transform: [{ translateY: plusY.value }] }));
  const pips = Array.from({ length: Math.max(1, p.setsToWin) }, (_, i) => i < p.setsWon);
  // QA B121-1 (1.3.1): the card is a plain View; the scoring button covers the top of it and the
  // footer row (timeout chip + "+") sits BELOW it, so the timeout <button> is neither inside the
  // scoring <button> in the DOM nor on top of it on screen.
  const pressIn = () => (press.value = withTiming(reduce ? 1 : 0.97, { duration: 90 }));
  const pressOut = () => (press.value = withSpring(1, { damping: 14, stiffness: 320 }));
  return (
    <Animated.View style={[s.halfOuter, { height: p.height, flex: 1 }, ring ? { borderColor: ring, borderWidth: 2 } : null, halfStyle]} testID={`half-${p.side}`}>
      <LinearGradient colors={teamGradient(p.color)} start={{ x: 0, y: 0 }} end={{ x: 0.35, y: 1 }} style={[s.half, { backgroundColor: p.color }]}>
        <View style={s.highlight} pointerEvents="none" />
        <Pressable
          testID={`tap-${p.side}`}
          onPress={p.onPoint}
          onPressIn={pressIn}
          onPressOut={pressOut}
          accessibilityRole="button"
          accessibilityLabel={t('score.pointTo', { team: p.name })}
          accessibilityHint={t('score.scoreIs', { n: p.score })}
          style={s.tapArea}
        >
            {/* QA B121-5: long names wrap to 2 lines (and step down a size) instead of truncating at 360 px;
                adjustsFontSizeToFit does nothing on web. */}
            <Text style={[s.teamName, teamNameSize(p.name), { color: ink.fg }]} numberOfLines={2} testID={`team-name-${p.side}`}>
              {p.name}
            </Text>
            <View style={s.pips} accessible accessibilityLabel={t('score.sets', { n: p.setsWon })} testID={`sets-${p.side}`}>
              {pips.map((on, i) => (
                <View key={i} style={[s.pip, { backgroundColor: on ? ink.fg : ink.scrim, borderColor: ink.outline }]} />
              ))}
            </View>
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
              <Animated.View style={scoreStyle}>
                <Text
                  style={[s.score, { color: ink.fg, textShadowColor: ink.shadow }, p.compact && s.scoreCompact]}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  allowFontScaling={false}
                  testID={`score-${p.side}`}
                >
                  {p.score}
                </Text>
              </Animated.View>
              <Animated.View style={[s.plus, plusStyle]} pointerEvents="none">
                <Text style={[s.plusText, { color: ink.fg }]}>+1</Text>
              </Animated.View>
              {p.showHint && !p.compact && (
                <Text style={[s.hint, { color: ink.fg, backgroundColor: ink.scrim, letterSpacing: letterSpacing(1) }]} numberOfLines={1} testID={`tap-hint-${p.side}`}>
                  {t('score.tapToScore')}
                </Text>
              )}
            </View>
            <View style={{ minHeight: 34, justifyContent: 'center', alignItems: 'center', maxWidth: '100%' }}>
              {p.point ? (
                <Text style={s.pointBadge} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID={`point-${p.side}`}>
                  {p.point === 'match' ? t('score.matchPoint') : t('score.setPoint')}
                </Text>
              ) : p.serving ? (
                <View style={[s.serve, { backgroundColor: pill.bg, borderColor: pill.border }]} testID={`serving-${p.side}`}>
                  <Ionicons name="tennisball" size={14} color={pill.fg} />
                  <Text style={[s.serveText, { color: pill.fg }]} numberOfLines={1}>
                    {t('score.serving')}
                  </Text>
                </View>
              ) : null}
            </View>
        </Pressable>
        {!p.compact && (
          <View style={s.footer} testID={`footer-${p.side}`}>
            <Pressable
              onPress={p.onTimeout}
              hitSlop={6}
              disabled={p.timeoutsLeft <= 0}
              accessibilityRole="button"
              accessibilityLabel={t('score.timeoutBtn', { n: p.timeoutsLeft })}
              accessibilityState={{ disabled: p.timeoutsLeft <= 0 }}
              testID={`timeout-${p.side}`}
              style={[s.toChip, { backgroundColor: ink.scrim, opacity: p.timeoutsLeft <= 0 ? 0.55 : 1 }]}
            >
              <Ionicons name="timer-outline" size={15} color={ink.fg} />
              {/* QA C130-5: the label wraps to a second line instead of being cut ("टाइमआउट (…") */}
              <Text style={[s.toText, { color: ink.fg }]} numberOfLines={2} testID={`timeout-label-${p.side}`}>
                {t('score.timeoutBtn', { n: p.timeoutsLeft })}
              </Text>
            </Pressable>
            {/* the "+" scores too, but it is not a second button for screen readers (the half is) */}
            <Pressable onPress={p.onPoint} onPressIn={pressIn} onPressOut={pressOut} hitSlop={8} accessible={false} importantForAccessibility="no-hide-descendants" style={s.plusBtn} testID={`plus-${p.side}`}>
              <Ionicons name="add-circle-outline" size={22} color={ink.fg} />
            </Pressable>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );
}

/** Font size for a score-half team name: 17 px, 15 px from 13 characters, 14 px from 20 (2 lines max). */
export function teamNameSize(name: string): { fontSize: number; lineHeight: number } {
  const n = [...(name ?? '')].length;
  return n >= 20 ? { fontSize: 14, lineHeight: 18 } : n >= 13 ? { fontSize: 15, lineHeight: 19 } : { fontSize: 17, lineHeight: 22 };
}

/** Last rally + the last 4 rally dots (team colours). */
export function RallyTicker({ text, dots, onPress }: { text: string; dots: string[]; onPress?: () => void }) {
  return (
    <Pressable style={s.ticker} onPress={onPress} accessibilityRole={onPress ? 'button' : 'text'} testID="rally-ticker">
      <Ionicons name="flash" size={16} color={colors.danger} />
      <Text style={s.tickerText} numberOfLines={1}>
        {text}
      </Text>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {dots.map((c, i) => (
          <View key={i} style={[s.dot, { backgroundColor: c }, teamRing(c) ? { borderWidth: 1.5, borderColor: palette.blueLine } : null]} />
        ))}
      </View>
    </Pressable>
  );
}

interface CourtTeam {
  side: Side;
  name: string;
  color: string;
  positions: readonly Slot[];
}

/**
 * Both teams on one court (left team faces right): front column next to the net in the middle,
 * back column outside; each player a 30 dp chip in the team colour (initials) with the first name
 * under it, the position number top-left, a light-blue ball badge on the server.
 */
export function CourtCard({ left, right, names, server, onSub }: { left: CourtTeam; right: CourtTeam; names: Record<string, string>; server: string | null; onSub?: () => void }) {
  const { t } = useTranslation();
  const half = (team: CourtTeam, screenSide: 'left' | 'right') => {
    const grid = courtGrid(screenSide);
    const fg = onColor(team.color);
    const ring = teamRing(team.color);
    return (
      <View style={s.courtHalf} testID={`court-${team.side}`} accessible accessibilityLabel={t('rotation.courtA11y', { team: team.name })}>
        {grid.map((row, r) => (
          <View key={r} style={s.courtRow}>
            {row.map((pos) => {
              const id = team.positions[pos - 1] ?? null;
              const nm = id ? firstName(names[id]) || '?' : '–';
              const initials = id ? (names[id] ?? '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') : '';
              return (
                <View key={pos} style={s.cell} testID={`court-${team.side}-p${pos}`}>
                  <Text style={s.cellPos}>{pos}</Text>
                  <View style={[s.chip, { backgroundColor: id ? team.color : colors.white, borderColor: ring ?? colors.white }, !id && { borderColor: colors.border, borderStyle: 'dashed' }]}>
                    <Text style={[s.chipText, { color: id ? fg : colors.muted }]} numberOfLines={1}>
                      {initials}
                    </Text>
                    {!!id && id === server && (
                      <View style={s.serverBadge} testID="court-server">
                        <Ionicons name="tennisball" size={10} color={colors.ink} />
                      </View>
                    )}
                  </View>
                  <Text style={s.cellName} numberOfLines={1}>
                    {nm}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };
  return (
    <View style={s.courtCard} testID="court-card">
      <View style={s.courtHead}>
        <Text style={[type.h3, { color: colors.text, flex: 1 }]}>{t('score.court')}</Text>
        {onSub && (
          <Pressable onPress={onSub} hitSlop={10} accessibilityRole="button" testID="court-sub" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}>
            <Ionicons name="swap-vertical" size={16} color={colors.primaryText} />
            <Text style={{ color: colors.primaryText, fontWeight: '700' }}>{t('score.sub')}</Text>
          </Pressable>
        )}
      </View>
      <View style={s.court}>
        {half(left, 'left')}
        <View style={s.net} />
        {half(right, 'right')}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  halfOuter: { borderRadius: radius.lg, ...elevation.e2, backgroundColor: 'transparent' },
  half: { flex: 1, borderRadius: radius.lg - 1, overflow: 'hidden', alignItems: 'center', paddingBottom: 10 },
  highlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 60, backgroundColor: 'rgba(255,255,255,0.06)' },
  teamName: { ...type.h3, fontSize: 17, fontWeight: '800', textAlign: 'center', maxWidth: '100%' },
  pips: { flexDirection: 'row', gap: 6, marginTop: 8 },
  pip: { width: 22, height: 6, borderRadius: 3, borderWidth: 0.5 },
  score: { ...type.score, textAlign: 'center', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  scoreCompact: { fontSize: 76, lineHeight: 84 },
  plus: { position: 'absolute', top: 6, right: 6 },
  plusText: { fontSize: 22, fontWeight: '900' },
  hint: { fontSize: 11, fontWeight: '800', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', marginTop: 2 },
  serve: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 4, maxWidth: '100%' },
  serveText: { fontWeight: '900', fontSize: 12, flexShrink: 1 },
  pointBadge: { backgroundColor: colors.gold, color: colors.ink, fontWeight: '900', fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden', maxWidth: '100%' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 6, gap: 6, paddingHorizontal: 10 },
  tapArea: { flex: 1, alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 10, paddingTop: 14 },
  plusBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  toChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 1 },
  /** over the bottom-left of the half (padding 10 + 2 px ring allowance), outside the scoring button */
  toText: { fontWeight: '800', fontSize: 13, lineHeight: 16, flexShrink: 1 },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 38, marginHorizontal: 12, marginTop: 10, ...elevation.e1 },
  tickerText: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 13 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  courtCard: { backgroundColor: colors.white, borderRadius: radius.md, marginHorizontal: 12, marginTop: 10, padding: 12, ...elevation.e2 },
  courtHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  court: { flexDirection: 'row', backgroundColor: palette.court, borderRadius: 10, borderWidth: 2, borderColor: colors.white, padding: 6 },
  courtHalf: { flex: 1, gap: 4 },
  net: { width: 4, backgroundColor: colors.ink, borderRadius: 2, marginHorizontal: 6 },
  courtRow: { flexDirection: 'row', justifyContent: 'space-around' },
  cell: { alignItems: 'center', width: '48%', paddingTop: 2 },
  cellPos: { position: 'absolute', top: 0, left: 2, fontSize: 9, fontWeight: '700', color: '#3F6E99' },
  chip: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center', ...elevation.e1 },
  chipText: { fontSize: 11, fontWeight: '800' },
  serverBadge: { position: 'absolute', right: -8, bottom: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  cellName: { fontSize: 11, fontWeight: '700', color: colors.text, marginTop: 2, maxWidth: '100%' },
});
