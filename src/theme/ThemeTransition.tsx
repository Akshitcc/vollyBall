/**
 * 1.4.21 "Sunset → Floodlight" transition – spec §6 (storyboard: volleylive-design/daynight/transition-storyboard.png).
 * Full-screen, pointerEvents none, above the navigator. Tokens swap UNDERNEATH while the overlay covers the screen.
 *  scene 1400 ms: sky day→dusk→night, the sun sinks behind the court, lamps flicker on, beams sweep (swap at 850 ms);
 *         reverse for sunrise (swap at 550 ms).
 *  fade  250 ms (Reduce Motion, animation switch off, Appearance change): veil in 120 → swap → out 130.
 *  live  400 ms (Live scoring, after the rally): veil to 0.85 in 200 → swap → out 200; never covers for long.
 * Built with RN Animated (spec suggests Reanimated; same timeline – see RELEASE notes).
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { ThemeName } from './resolve';
import { tokens } from './tokens';

export type TransitionMode = 'scene' | 'fade' | 'live';
export type TransitionHandle = { play(next: ThemeName, mode: TransitionMode, onCovered: () => void): void };
export const SCENE_MS = 1400, FADE_MS = 250, LIVE_FADE_MS = 400;
export const coveredAt = (next: ThemeName) => (next === 'night' ? 850 : 550);
const SKY = { day: '#9FD8FF', dusk: '#FF5A5F', night: '#05070F' };

export const ThemeTransition = forwardRef<TransitionHandle>(function ThemeTransition(_p, ref) {
  const [run, setRun] = useState<{ next: ThemeName; mode: TransitionMode; id: number } | null>(null);
  const p = useRef(new Animated.Value(0)).current; // 0..1 scene progress, direction-aware below
  const veil = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  useImperativeHandle(ref, () => ({
    play(next, mode, onCovered) {
      if (busy.current) { onCovered(); return; } // one animation per switch
      busy.current = true;
      const id = Date.now();
      setRun({ next, mode, id });
      const end = () => { busy.current = false; setRun(null); };
      if (mode !== 'scene') {
        const [inMs, outMs, peak] = mode === 'live' ? [LIVE_FADE_MS / 2, LIVE_FADE_MS / 2, 0.85] : [120, 130, 1];
        veil.setValue(0);
        Animated.timing(veil, { toValue: peak, duration: inMs, useNativeDriver: false }).start(() => {
          onCovered();
          Animated.timing(veil, { toValue: 0, duration: outMs, useNativeDriver: false }).start(end);
        });
        return;
      }
      p.setValue(0);
      const swapAt = coveredAt(next);
      const t = setTimeout(onCovered, swapAt);
      Animated.timing(p, { toValue: 1, duration: SCENE_MS, easing: Easing.linear, useNativeDriver: false }).start(() => { clearTimeout(t); end(); });
    },
  }), [p, veil]);
  if (!run) return null;
  if (run.mode !== 'scene') {
    return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tokens[run.next].bg, opacity: veil }]} testID={`theme-fade-${run.next}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />;
  }
  // q: progress in "sunset" terms (0 day … 1 night); sunrise plays it backwards
  const q = run.next === 'night' ? p : p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const overlay = p.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 0.6, 1, 1, 0] });
  const dayO = q.interpolate({ inputRange: [0, 0.45], outputRange: [1, 0], extrapolate: 'clamp' });
  const duskO = q.interpolate({ inputRange: [0, 0.45, 0.7], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const nightO = q.interpolate({ inputRange: [0.45, 0.7], outputRange: [0, 1], extrapolate: 'clamp' });
  const sunY = q.interpolate({ inputRange: [0, 0.25, 0.54], outputRange: [250, 400, 520], extrapolate: 'clamp' });
  const lamp = q.interpolate({ inputRange: [0, 0.54, 0.58, 0.62, 0.68, 0.75, 1], outputRange: [0, 0, 1, 1, 0.3, 1, 1], extrapolate: 'clamp' });
  const beamO = q.interpolate({ inputRange: [0.54, 0.6, 1], outputRange: [0, 0.55, 0.35], extrapolate: 'clamp' });
  const beamL = q.interpolate({ inputRange: [0.54, 0.75, 1], outputRange: ['-24deg', '24deg', '6deg'], extrapolate: 'clamp' });
  const beamR = q.interpolate({ inputRange: [0.54, 0.75, 1], outputRange: ['24deg', '-24deg', '-6deg'], extrapolate: 'clamp' });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: overlay, overflow: 'hidden' }]} testID={`theme-scene-${run.next}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* solid base: the stacked sky layers below never let the UI show through while covered */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SKY.dusk }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SKY.day, opacity: dayO }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SKY.dusk, opacity: duskO }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SKY.night, opacity: nightO }]} />
      <Animated.View style={{ position: 'absolute', left: '50%', marginLeft: -60, top: 0, width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFC531', transform: [{ translateY: sunY }] }} />
      {/* beams from the two floodlight poles */}
      <Animated.View style={[s.beam, { left: 20, opacity: beamO, transform: [{ rotate: beamL }] }]} />
      <Animated.View style={[s.beam, { right: 20, opacity: beamO, transform: [{ rotate: beamR }] }]} />
      {/* court (hides the sun when it sinks) + poles + lamps */}
      <View style={s.court}><View style={s.net} /></View>
      <View style={[s.pole, { left: 40 }]} /><View style={[s.pole, { right: 40 }]} />
      <Animated.View style={[s.lamp, { left: 28, opacity: lamp }]} /><Animated.View style={[s.lamp, { right: 28, opacity: lamp }]} />
    </Animated.View>
  );
});

const s = StyleSheet.create({
  court: { position: 'absolute', left: 0, right: 0, top: 520, bottom: 0, backgroundColor: '#1B2440', borderTopWidth: 4, borderTopColor: '#C6FF1A' },
  net: { position: 'absolute', left: '15%', right: '15%', top: 40, height: 4, backgroundColor: '#F4F7FF' },
  pole: { position: 'absolute', top: 300, width: 6, height: 220, backgroundColor: '#33406A' },
  lamp: { position: 'absolute', top: 284, width: 30, height: 18, borderRadius: 6, backgroundColor: '#F4F7FF' },
  beam: { position: 'absolute', top: 290, width: 110, height: 380, backgroundColor: 'rgba(198,255,26,0.5)', borderBottomLeftRadius: 60, borderBottomRightRadius: 60 },
});
