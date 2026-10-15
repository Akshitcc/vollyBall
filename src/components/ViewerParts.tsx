/**
 * Live match v2 scoreboard (design-spec §11.1), shared by the scorer and the viewer: navy card,
 * team dot + name, 76 dp tabular scores (the trailing team in #DCE6F2), sets-won bars, the Serving
 * pill on the serving team, and in the centre the sets count with the finished set chips and the
 * current set chip. A score change rolls in (up for a point, down for an undo) with a light-blue glow;
 * Reduce Motion turns that into a 150 ms fade.
 *
 * 1.3.3 (scorer only): with `onTeamPoint` each team column is a tap panel (≥ 48 dp, ~127×179) –
 * team +1 with no player credit. Press: scale 0.97 + white/blue ring + 14% white fill; a green +1
 * bump on the panel's top edge for 450 ms. The viewer passes no `onTeamPoint`: no panel, no hint.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { MatchState, Side } from '../core/scoring';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { letterSpacing } from '../i18n/format';
import { colors, themed } from '../theme';
import { useTheme } from '../theme/ThemeProvider';
import { useHiFont } from '../theme/useHiFont';
import { PressableScale } from './PressableScale';

/** What a score change looks like: a roll, or with Reduce Motion a fade (never movement). */
export const bumpKind = (reduceMotion: boolean): 'bump' | 'fade' => (reduceMotion ? 'fade' : 'bump');
/** The trailing team's score colour on the navy scoreboard (§11.1). */
export const TRAILING_SCORE = '#DCE6F2';

/**
 * 1.3.4 (QA D133-1… D133-4): the score is never hidden while it rolls. Before, each new value was a
 * re-mounted view entering with SlideInDown/SlideInUp – which starts a full *window height* away
 * inside an overflow-hidden box. When the browser didn't run that animation (background tab, busy
 * main thread – QA saw it on the ~1024 px viewer) both big scores stayed blank. Now the same Text
 * stays mounted and only nudges ±ROLL_PX back to 0 (clamped), so a stalled or broken animation clock
 * still shows the number.
 */
export const ROLL_PX = 14;
export function RollScore({ value, style, testID }: { value: number; style?: StyleProp<TextStyle>; testID?: string }) {
  const reduce = useReduceMotion();
  const prev = useRef(value);
  const glow = useSharedValue(0);
  const y = useSharedValue(0);
  const fade = useSharedValue(1);
  useEffect(() => {
    if (value !== prev.current) {
      if (reduce) {
        fade.value = 0.5;
        fade.value = withTiming(1, { duration: 150 });
      } else {
        y.value = value > prev.current ? ROLL_PX : -ROLL_PX;
        y.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
        // (no glow on the web: a stalled page clock could leave the light-blue square over the number)
        if (value > prev.current && Platform.OS !== 'web') glow.value = withSequence(withTiming(0.45, { duration: 100 }), withTiming(0, { duration: 140 }));
      }
    }
    prev.current = value;
  }, [value, reduce, glow, y, fade]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(0.45, Number.isFinite(glow.value) ? glow.value : 0)) }));
  // Clamped: whatever the animation clock does (a paused or throttled page can hand it odd frame
  // times), the number is never more than ROLL_PX away and never fainter than half.
  const rollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(-ROLL_PX, Math.min(ROLL_PX, Number.isFinite(y.value) ? y.value : 0)) }],
    opacity: Math.max(0.5, Math.min(1, Number.isFinite(fade.value) ? fade.value : 1)),
  }));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minWidth: 64 }}>
      <Animated.View pointerEvents="none" style={[st.glow, glowStyle]} />
      <Animated.View style={rollStyle}>
        <Text style={[st.score, style]} testID={testID} accessibilityLiveRegion="polite" numberOfLines={1}>
          {value}
        </Text>
      </Animated.View>
    </View>
  );
}
/** Kept for 1.3.2 tests / callers: the bump is the roll above. */
export const BumpScore = RollScore;

export function ServingPill({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  const { t: tk, name } = useTheme();
  const f = useHiFont();
  const day = name === 'day';
  // 1.4.22 (spec v2 *-02): Day = Ball pill with ink border; Night = Volt pill, Teko caps
  return (
    <View style={[st.pill, { backgroundColor: day ? tk.accent : tk.primary }, day ? { borderWidth: 2, borderColor: tk.outline } : null]} testID={testID} accessible accessibilityLabel={t('viewer.serving')}>
      <Ionicons name="tennisball" size={14} color={day ? tk.text : tk.onPrimary} />
      <Text style={[st.pillText, { color: day ? tk.text : tk.onPrimary }, day ? f.bold : f.display, f.upper && { textTransform: 'uppercase', fontSize: 17, letterSpacing: 1 }]} numberOfLines={1}>
        {t('viewer.serving')}
      </Text>
    </View>
  );
}

/** LIVE pill with a pulsing dot (1400 ms; still with Reduce Motion). */
export function PulsingLive() {
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const v = useSharedValue(1);
  useEffect(() => {
    if (!reduce) v.value = withRepeat(withSequence(withTiming(0.25, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false);
  }, [reduce, v]);
  const dot = useAnimatedStyle(() => ({ opacity: v.value }));
  const { t: tk, name } = useTheme();
  const day = name === 'day';
  return (
    <View style={[st.live, { backgroundColor: tk.live, borderColor: day ? tk.outline : tk.live, borderRadius: day ? 999 : 6 }]} testID="live-pill" accessible accessibilityLabel={t('common.live')}>
      <Animated.View style={[st.liveDot, { backgroundColor: tk.onLive }, dot]} />
      <Text style={[st.liveText, { color: tk.onLive, letterSpacing: letterSpacing(1) }]}>{t('common.live')}</Text>
    </View>
  );
}

export interface ScoreboardTeam {
  name: string;
  color: string;
}

/** The navy scoreboard. `left`/`right` follow the scorer's Swap; `scoreRef` lets the +1 fly to a score. */
export const LiveScoreboard = forwardRef<View, {
  teamA: ScoreboardTeam;
  teamB: ScoreboardTeam;
  st: MatchState;
  setsNeeded: number;
  live: boolean;
  left?: Side;
  scoreRefs?: Partial<Record<Side, React.RefObject<View | null>>>;
  testID?: string;
  /** Scorer only: tap a team's panel → team point (no player credit). */
  onTeamPoint?: (side: Side) => boolean | void;
  disabled?: boolean;
  /**
   * 1.4.5 (QA V144-6): show the points of the set in progress although the match isn't live – an ABANDONED match
   * shows the replayed score at the moment it was abandoned (it showed the sets, 0–0, next to "Points 0–10").
   */
  showCurrent?: boolean;
}>(function LiveScoreboard({ teamA, teamB, st, setsNeeded, live, left = 'A', scoreRefs, testID = 'live-scoreboard', onTeamPoint, disabled, showCurrent }, ref) {
  const { t } = useTranslation();
  const reduce = useReduceMotion();
  const [bump, setBump] = useState<{ side: Side; k: number } | null>(null);
  useEffect(() => {
    if (!bump) return;
    const tm = setTimeout(() => setBump((b) => (b?.k === bump.k ? null : b)), 450);
    return () => clearTimeout(tm);
  }, [bump]);
  const order: Side[] = left === 'A' ? ['A', 'B'] : ['B', 'A'];
  // 1.4.22 (spec v2 *-02 / *-15): Day = team-filled sticker panels (ink border + hard shadow) with the score on a
  // tilted white sticker; Night = dark panels with a side-colour border/glow and neon Teko numerals. Side tokens
  // (teamA / teamB) colour the panels; the team's own colour stays as the dot by its name.
  const { t: tk, name: theme } = useTheme();
  const hf = useHiFont();
  const day = theme === 'day';
  const sideCol = (side: Side) => (side === 'A' ? tk.teamA : tk.teamB);
  const onSide = (side: Side) => (day ? (side === 'A' ? tk.onPrimary : tk.onTeamB) : tk.text);
  const score = (side: Side) => (live || showCurrent ? (side === 'A' ? st.current.a : st.current.b) : side === 'A' ? st.setsWon.A : st.setsWon.B);
  const lead = score('A') === score('B') ? null : score('A') > score('B') ? 'A' : 'B';
  return (
    <View ref={ref} style={st2.row} testID={testID}>
      {order.map((side, i) => {
        const team = side === 'A' ? teamA : teamB;
        const won = side === 'A' ? st.setsWon.A : st.setsWon.B;
        const serving = live && st.serving === side && !st.finished;
        return (
          <React.Fragment key={side}>
            {i === 1 && (
              <View style={st2.center} testID="viewer-sets">
                <Text style={[st2.overline, { color: tk.textMuted }, day ? hf.bold : hf.display, !day && hf.upper && { fontSize: 15 }]}>{t('common.sets')}</Text>
                <Text style={[st2.sets, { color: tk.text, fontFamily: tk.font.score, fontWeight: 'normal' }, !day && { fontSize: 34 }]} testID="viewer-sets-count">
                  {left === 'A' ? `${st.setsWon.A}:${st.setsWon.B}` : `${st.setsWon.B}:${st.setsWon.A}`}
                </Text>
                {st.sets.map((x, k) => (
                  <View key={k} style={[st2.setChip, { backgroundColor: day ? tk.surface : 'transparent', borderWidth: day ? 1.5 : 0, borderColor: tk.outline }]}>
                    <Text style={[st2.setChipText, { color: day ? tk.text : tk.textMuted }]}>{left === 'A' ? `${x.a}–${x.b}` : `${x.b}–${x.a}`}</Text>
                  </View>
                ))}
                {live && !st.finished && (
                  <View style={[st2.setChip, { backgroundColor: day ? tk.accent : 'transparent', borderWidth: day ? 1.5 : 0, borderColor: tk.outline }]} testID="viewer-set-now">
                    <Text style={[st2.setChipText, { color: day ? tk.text : tk.primary }]}>{t('match.setShort', { n: st.setIndex + 1 })}</Text>
                  </View>
                )}
              </View>
            )}
            {(() => {
              const content = (pressed: boolean) => (
                <View style={{ alignItems: 'center', width: '100%' }} testID={`viewer-team-${side}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%' }}>
                    <View style={[st2.dot, { backgroundColor: team.color, borderColor: day ? tk.outline : tk.text }]} />
                    {/* 1.3.4: long names ("Yamuna Blockers") wrap to 2 lines / shrink instead of "Yamuna Block…" */}
                    <Text style={[st2.name, { color: onSide(side) }, hf.bold]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} testID={`team-name-${side}`}>
                      {team.name}
                    </Text>
                  </View>
                  <View ref={scoreRefs?.[side]} collapsable={false} style={day ? { marginTop: 8, marginBottom: 4, transform: [{ rotate: side === 'A' ? '-3deg' : '3deg' }] } : null}>
                    {day ? <View pointerEvents="none" style={{ position: 'absolute', left: 3, top: 3, right: -3, bottom: -3, borderRadius: 16, backgroundColor: tk.outline }} /> : null}
                    <View style={day ? { backgroundColor: tk.surface, borderRadius: 16, borderWidth: 2, borderColor: tk.outline, paddingHorizontal: 8 } : null}>
                      <RollScore value={score(side)} style={[{ fontFamily: tk.font.score, fontWeight: 'normal', color: day ? tk.text : sideCol(side) }, day ? { fontSize: 64, lineHeight: 72 } : { fontSize: 92, lineHeight: 92 }, !day && lead && lead !== side ? { opacity: 0.8 } : null]} testID={`viewer-score-${side}`} />
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }} accessibilityLabel={t('viewer.setsWon', { count: won })} testID={`sets-won-${side}`}>
                    {Array.from({ length: setsNeeded }, (_, k) => (
                      <View key={k} style={[st2.pip, { backgroundColor: day ? tk.surface : tk.surface2, borderWidth: day ? 1.5 : 0, borderColor: tk.outline, height: 7 }, k < won && { backgroundColor: day ? tk.text : sideCol(side) }]} />
                    ))}
                  </View>
                  {/* 1.4.5 (QA V144-7): the Serving badge is information only – on the scorer's panel a press on it is caught
                      here (the innermost responder wins) and never reaches the panel, so it can't score a point */}
                  {serving ? (
                    onTeamPoint ? (
                      <Pressable onPress={() => {}} accessible={false} focusable={false} testID={`serving-guard-${side}`} style={{ cursor: 'auto' } as object}>
                        <ServingPill testID={`serving-${side}`} />
                      </Pressable>
                    ) : (
                      <ServingPill testID={`serving-${side}`} />
                    )
                  ) : (
                    <View style={{ height: 38 }} />
                  )}
                  {/* 1.4.4 (QA V143-12): no "Tap · team +1" once the match is over (the panels no longer score) */}
                  {onTeamPoint && !st.finished && (
                    <View style={[st2.hint, { borderColor: day ? onSide(side) : tk.outline, backgroundColor: day ? (pressed ? tk.surface : 'transparent') : pressed ? tk.surface2 : 'transparent' }]} testID={`team-panel-hint-${side}`}>
                      <Ionicons name="add-circle" size={14} color={day ? (pressed ? tk.text : onSide(side)) : tk.textMuted} />
                      <Text style={[st2.hintText, { color: day ? (pressed ? tk.text : onSide(side)) : tk.textMuted }]} numberOfLines={1}>
                        {t('liveV2.tapTeamHint')}
                      </Text>
                    </View>
                  )}
                </View>
              );
              const panelLook = [st2.panel, day
                ? { backgroundColor: sideCol(side), borderWidth: 2, borderColor: tk.outline, borderRadius: tk.radius.card }
                : { backgroundColor: tk.surface, borderWidth: 1.5, borderColor: sideCol(side), borderRadius: tk.radius.card, shadowColor: sideCol(side), shadowOpacity: serving ? 0.45 : 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } }];
              const shadowV = day ? <View pointerEvents="none" style={{ position: 'absolute', left: 4, top: 4, right: -4, bottom: -4, borderRadius: tk.radius.card, backgroundColor: tk.outline }} /> : null;
              if (!onTeamPoint)
                return (
                  <View style={{ flex: 1, marginRight: day ? 4 : 0, marginBottom: day ? 4 : 0 }} testID={`viewer-panel-${side}`}>
                    {shadowV}
                    <View style={panelLook}>{content(false)}</View>
                  </View>
                );
              return (
                <PressableScale
                  onPress={() => {
                    if (disabled) return;
                    if (onTeamPoint(side) !== false) setBump({ side, k: Date.now() });
                  }}
                  disabled={disabled}
                  scaleTo={0.97}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!disabled }}
                  accessibilityLabel={t('liveV2.teamPanelA11y', { team: team.name, score: score(side) })}
                  accessibilityHint={t('liveV2.teamPanelHint', { team: team.name })}
                  style={({ pressed }: { pressed: boolean }) => [{ flex: 1, minHeight: 214, marginRight: day ? 4 : 0, marginBottom: day ? 4 : 0 }, disabled && { opacity: 0.55 }]}
                  testID={`team-panel-${side}`}
                >
                  {({ pressed }: { pressed: boolean }) => (
                    <>
                      {shadowV}
                      <View style={[panelLook, pressed && !disabled && { borderWidth: 3, borderColor: day ? tk.outline : tk.primary, paddingVertical: 8, paddingHorizontal: 4 }]}>
                        {content(pressed && !disabled)}
                      </View>
                      {bump?.side === side && (
                        <Animated.View key={bump.k} entering={FadeIn.duration(reduce ? 150 : 120)} pointerEvents="none" style={[st2.bump, { backgroundColor: day ? tk.accent : tk.primary, borderColor: tk.outline }]} testID={`team-panel-bump-${side}`}>
                          <Text style={[st2.bumpText, { color: day ? tk.text : tk.onPrimary }]}>+1</Text>
                        </Animated.View>
                      )}
                    </>
                  )}
                </PressableScale>
              );
            })()}
          </React.Fragment>
        );
      })}
    </View>
  );
});

const st = themed(() => StyleSheet.create({
  score: { color: colors.white, fontSize: 76, lineHeight: 84, fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: 'center' },
  glow: { position: 'absolute', width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primary },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 12, minHeight: 30, marginTop: 8, maxWidth: '100%' },
  pillText: { color: colors.onPrimary, fontWeight: '800', fontSize: 13, flexShrink: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.live, borderRadius: 999, paddingHorizontal: 12, minHeight: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.card },
  liveText: { color: colors.white, fontWeight: '900', fontSize: 13 },
}));
const st2 = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  center: { width: 64, alignItems: 'center', paddingTop: 22 },
  overline: { color: colors.onInkMuted, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  sets: { color: colors.white, fontSize: 28, lineHeight: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  setChip: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  setChipText: { color: colors.white, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.white, marginRight: 6 },
  name: { color: colors.white, fontWeight: '800', fontSize: 14, lineHeight: 18, flexShrink: 1, textAlign: 'center' },
  pip: { width: 18, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  panel: { flex: 1, minHeight: 214, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.07)', paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  panelPressed: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 3, borderColor: colors.primary, paddingVertical: 8, paddingHorizontal: 4 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 24, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', paddingHorizontal: 10, marginTop: 8, maxWidth: '100%' },
  hintText: { color: colors.white, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  bump: { position: 'absolute', top: -10, right: 10, backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 2, borderColor: colors.white },
  bumpText: { color: colors.white, fontWeight: '900', fontSize: 12 },
}));

export interface Flight {
  from: { x: number; y: number };
  to: { x: number; y: number };
  key: number;
}

/**
 * The green "+1" token that flies from the tapped chip to the team score (§11.4): quadratic curve
 * bowing outwards, 420 ms ease-in-out cubic, scale 1 → 0.8, fades in the last 80 ms. One absolutely
 * positioned overlay at the screen root. Not rendered with Reduce Motion (the caller skips it).
 */
export function FlyingPoint({ flight, onDone }: { flight: Flight | null; onDone: () => void }) {
  const p = useSharedValue(0);
  const pts = useSharedValue({ sx: 0, sy: 0, cx: 0, cy: 0, ex: 0, ey: 0 });
  useEffect(() => {
    if (!flight) return;
    const { from, to } = flight;
    pts.value = { sx: from.x, sy: from.y, cx: Math.max(from.x, to.x) + 50, cy: (from.y + to.y) / 2, ex: to.x, ey: to.y };
    p.value = 0;
    p.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }, (done) => {
      if (done) runOnJS(onDone)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight?.key]);
  const style = useAnimatedStyle(() => {
    const t = p.value;
    const u = 1 - t;
    const v = pts.value;
    const x = u * u * v.sx + 2 * u * t * v.cx + t * t * v.ex;
    const y = u * u * v.sy + 2 * u * t * v.cy + t * t * v.ey;
    return { transform: [{ translateX: x - 20 }, { translateY: y - 12 }, { scale: 1 - 0.2 * t }], opacity: t > 0.8 ? (1 - t) * 5 : 1 };
  });
  if (!flight) return null;
  return (
    <Animated.View pointerEvents="none" style={[st3.token, style]} testID="flying-point">
      <Text style={st3.tokenText}>+1</Text>
    </Animated.View>
  );
}

const st3 = themed(() => StyleSheet.create({
  token: { position: 'absolute', left: 0, top: 0, zIndex: 50, backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1.5, borderColor: colors.white },
  tokenText: { color: colors.white, fontWeight: '900', fontSize: 12 },
}));
