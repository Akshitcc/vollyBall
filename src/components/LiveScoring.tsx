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
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { courtGrid, type Slot } from '../core/rotation';
import type { Side } from '../core/scoring';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { letterSpacing } from '../i18n/format';
import { chipGradient, colors, elevation, onColor, palette, radius, servePill, teamGradient, teamInk, teamRing, type } from '../theme';
import { firstName } from './MiniCourt';
import { PressableScale } from './PressableScale';

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
      <Text style={s.tickerText} numberOfLines={2} testID="rally-ticker-text">
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

/** Where a tapped chip is on screen (window coordinates), for the flying "+1" (§11.4). */
export type ChipOrigin = () => Promise<{ x: number; y: number } | null>;

/**
 * Both teams on one court (left team faces right), design 11 "live match v2" §11.2: front column
 * next to the net, back column outside; every player a 84 dp chip in the team colour with the
 * position badge, their live points ("6 pts"), the first name, a ball badge on the server and a gold
 * underline under each team's top scorer.
 *
 * With `onPlayer` the chips are the scoring buttons (tap the player who won the rally: player AND
 * team +1 in one event, core/scoring.ts playerPoint). Without it the court is read-only (viewer: no
 * shadow, no press, role text).
 */
export function CourtCard({
  left,
  right,
  names,
  server,
  onSub,
  points,
  onPlayer,
  disabled,
  title,
  testID = 'court-card',
}: {
  left: CourtTeam;
  right: CourtTeam;
  names: Record<string, string>;
  server: string | null;
  onSub?: () => void;
  /** player id → points credited so far (core/stats.ts playerPointCounts). */
  points?: Record<string, number>;
  /** Tap a player to score (scorer only). */
  onPlayer?: (side: Side, playerId: string, origin: ChipOrigin) => void;
  /** Set / match over or waiting for the lineup: chips at 40 %, a11y disabled. */
  disabled?: boolean;
  title?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const pts = points ?? {};
  const half = (team: CourtTeam, screenSide: 'left' | 'right') => {
    const grid = courtGrid(screenSide);
    const fg = onColor(team.color); // white or navy text on the chip (≥ 4.5:1)
    const best = Math.max(0, ...team.positions.map((id) => (id ? (pts[id] ?? 0) : 0)));
    return (
      <View style={[s.courtHalf, onPlayer && { gap: 8 }]} testID={`court-${team.side}`} accessibilityLabel={t('rotation.courtA11y', { team: team.name })}>
        {grid.map((row, r) => (
          <View key={r} style={s.courtRow}>
            {row.map((pos) => {
              const id = team.positions[pos - 1] ?? null;
              return (
                <View key={pos} style={s.cell} testID={`court-${team.side}-p${pos}`}>
                  <PlayerTile
                    id={id}
                    pos={pos}
                    name={id ? firstName(names[id]) || '?' : '–'}
                    fullName={id ? (names[id] ?? '') : ''}
                    team={team}
                    fg={fg}
                    count={id ? (pts[id] ?? 0) : 0}
                    showCount={!!points}
                    top={!!id && best > 0 && (pts[id] ?? 0) === best}
                    serving={!!id && id === server}
                    disabled={!!disabled}
                    onPress={onPlayer && id ? (origin) => onPlayer(team.side, id, origin) : undefined}
                  />
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };
  return (
    <View style={s.courtCard} testID={testID}>
      <View style={s.courtHead}>
        <Ionicons name={onPlayer ? 'hand-left-outline' : 'people-outline'} size={18} color={colors.text} style={{ marginRight: 6 }} />
        <Text style={[type.h3, { color: colors.text, flex: 1 }]} numberOfLines={2} testID="court-title">
          {title ?? (onPlayer ? t('liveV2.tapPlayerToScore') : points ? `${t('liveV2.court')} · ${t('score.ptsShort')}` : t('score.court'))}
        </Text>
        {!onPlayer && points && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="court-top-legend">
            <View style={[s.topBarLegend]} />
            <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{t('liveV2.topScorer')}</Text>
          </View>
        )}
        {onSub && (
          <Pressable onPress={onSub} hitSlop={10} accessibilityRole="button" testID="court-sub" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingLeft: 8 }}>
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

/**
 * One court chip (§11.2 / §11.4). Pressed: scale 0.94 + light-blue ring. When the count goes up it
 * pops (1 → 1.2 → spring) with a green "+1" bump; when it goes down (undo) a red "−1" bump shows for
 * 600 ms. Reduce Motion: no scale/pop, the bumps only fade.
 */
function PlayerTile(p: {
  id: string | null;
  pos: number;
  name: string;
  fullName: string;
  team: CourtTeam;
  fg: string;
  count: number;
  showCount: boolean;
  top: boolean;
  serving: boolean;
  disabled: boolean;
  onPress?: (origin: ChipOrigin) => void;
}) {
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const pop = useSharedValue(1);
  const last = useRef(p.count);
  const box = useRef<View>(null);
  const [bump, setBump] = React.useState<{ d: 1 | -1; k: number } | null>(null);
  useEffect(() => {
    if (p.count !== last.current) {
      const d = p.count > last.current ? 1 : -1;
      if (d > 0 && !reduce) pop.value = withSequence(withTiming(1.2, { duration: 80 }), withSpring(1, { damping: 12, stiffness: 260 }));
      setBump({ d, k: Date.now() });
      const tm = setTimeout(() => setBump(null), 600);
      last.current = p.count;
      return () => clearTimeout(tm);
    }
  }, [p.count, reduce, pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  if (!p.id)
    return (
      <View style={[s.tile, s.tileEmpty]}>
        <Text style={s.tilePosEmpty}>{p.pos}</Text>
        <Text style={[s.tileName, { color: colors.muted }]}>–</Text>
      </View>
    );
  const fg = p.fg;
  const darkFill = fg === colors.white;
  const label = p.showCount ? t('liveV2.playerChipA11y', { name: p.fullName || p.name, pos: p.pos, count: p.count }) : `${p.fullName || p.name}, ${p.pos}`;
  const body = (pressed: boolean) => (
    <>
      <LinearGradient colors={chipGradient(p.team.color)} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]} />
      <View style={[s.tilePos, { backgroundColor: darkFill ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.55)' }]}>
        <Text style={[s.tilePosText, { color: darkFill ? colors.white : colors.ink }]}>{p.pos}</Text>
      </View>
      {p.showCount ? (
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'baseline' }, popStyle]}>
          <Text style={[s.tileCount, { color: fg }]} testID={`court-pts-${p.id}`}>
            {p.count}
          </Text>
          <Text style={[s.tilePts, { color: fg }]}>{t('score.ptsShort')}</Text>
        </Animated.View>
      ) : null}
      <Text style={[s.tileName, { color: fg }]} numberOfLines={1} ellipsizeMode="tail">
        {p.name}
      </Text>
      {p.top && <View style={s.topBar} testID={`court-top-${p.id}`} />}
      {p.serving && (
        <View style={s.serverBadge} testID="court-server">
          <Ionicons name="tennisball" size={12} color={colors.ink} />
        </View>
      )}
      {pressed && <View pointerEvents="none" style={s.ring} />}
      {bump && (
        <Animated.View key={bump.k} entering={FadeIn.duration(reduce ? 150 : 120)} exiting={FadeOut.duration(150)} pointerEvents="none" style={[s.bump, { backgroundColor: bump.d > 0 ? colors.success : colors.lossText }]} testID={`court-bump-${p.id}`}>
          <Text style={s.bumpText}>{bump.d > 0 ? '+1' : '−1'}</Text>
        </Animated.View>
      )}
    </>
  );
  const border = { borderColor: 'rgba(255,255,255,0.35)' };
  if (!p.onPress)
    return (
      <View style={[s.tile, border, s.tileViewer]} accessible accessibilityRole="text" accessibilityLabel={label} testID={`court-tile-${p.id}`}>
        {body(false)}
      </View>
    );
  const origin: ChipOrigin = () =>
    new Promise((resolve) => {
      const done = setTimeout(() => resolve(null), 120);
      try {
        box.current?.measureInWindow?.((x, y, w, h) => {
          clearTimeout(done);
          resolve(w || h ? { x: x + w / 2, y: y + h / 3 } : null);
        });
      } catch {
        clearTimeout(done);
        resolve(null);
      }
    });
  return (
    <View ref={box} collapsable={false}>
      <PressableScale
        onPress={() => p.onPress?.(origin)}
        disabled={p.disabled}
        scaleTo={0.94}
        android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false }}
        accessibilityRole="button"
        accessibilityState={{ disabled: p.disabled }}
        accessibilityLabel={label}
        accessibilityHint={t('score.tileHint', { name: p.fullName || p.name, team: p.team.name })}
        style={[s.tile, s.tileScorer, border, elevation.e1, p.disabled && { opacity: 0.4 }]}
        testID={`court-tile-${p.id}`}
      >
        {({ pressed }: { pressed: boolean }) => body(pressed && !p.disabled)}
      </PressableScale>
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
  courtHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, minHeight: 32 },
  court: { flexDirection: 'row', backgroundColor: palette.court, borderRadius: 12, borderWidth: 2, borderColor: colors.white, padding: 6 },
  courtHalf: { flex: 1, gap: 6 },
  net: { width: 4, backgroundColor: colors.ink, borderRadius: 2, marginHorizontal: 5 },
  courtRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  cell: { flex: 1 },
  tile: { minHeight: 84, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingTop: 12, paddingBottom: 8, paddingHorizontal: 3 },
  tileViewer: {},
  /** 1.3.3: the Opp. error row is gone, so scorer chips grow to 70×90 in 98 dp rows (§11.1); viewer stays 84. */
  // 1.3.4 (QA C133 chip width): never narrower than 48 dp (measured 67.5×90 at a 360 px viewport: 2 chips per row per half)
  tileScorer: { minHeight: 90, minWidth: 48 },
  tileEmpty: { backgroundColor: colors.white, borderColor: colors.border, borderStyle: 'dashed' },
  tilePos: { position: 'absolute', top: 5, left: 5, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tilePosText: { fontSize: 10, fontWeight: '800' },
  tilePosEmpty: { position: 'absolute', top: 4, left: 6, fontSize: 10, fontWeight: '700', color: colors.muted },
  tileCount: { fontSize: 24, lineHeight: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tilePts: { fontSize: 10, fontWeight: '700', marginLeft: 2 },
  tileName: { fontSize: 12, fontWeight: '700', marginTop: 2, maxWidth: 64 },
  topBar: { position: 'absolute', bottom: -6, alignSelf: 'center', width: 30, height: 3, borderRadius: 2, backgroundColor: colors.gold },
  topBarLegend: { width: 16, height: 3, borderRadius: 2, backgroundColor: colors.gold },
  serverBadge: { position: 'absolute', right: -6, top: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 19, borderWidth: 3, borderColor: colors.primary },
  bump: { position: 'absolute', top: -10, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
  bumpText: { color: colors.white, fontWeight: '900', fontSize: 12 },
});
