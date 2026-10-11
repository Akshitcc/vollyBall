/**
 * Redesign building blocks ("Navy Live", design-spec §8 Shared): gradient hero header, glass
 * buttons, section headers, progress bar, skeleton blocks and the empty-state card.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { colors, elevation, gradients, palette, radius, type } from '../theme';
import { PressableScale } from './PressableScale';

export function HeroHeader({ children, overlap = 0, testID, style, safeTop = true }: { children: React.ReactNode; overlap?: number; testID?: string; style?: StyleProp<ViewStyle>; safeTop?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={gradients.hero as unknown as [string, string, string]}
      locations={gradients.heroLocations as unknown as [number, number, number]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ paddingTop: (safeTop ? insets.top : 0) + 12, paddingHorizontal: 16, paddingBottom: 16 + overlap }, style]}
      testID={testID}
    >
      {children}
    </LinearGradient>
  );
}

export function GlassButton({ icon, label, onPress, testID, dot }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string; dot?: boolean }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={s.glass} hitSlop={4}>
      <Ionicons name={icon} size={20} color={colors.white} />
      {dot && <View style={s.glassDot} />}
    </PressableScale>
  );
}

export function GlassTag({ icon, text }: { icon?: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={s.tag}>
      {icon && <Ionicons name={icon} size={14} color={colors.white} />}
      <Text style={s.tagText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function SectionHeader({ title, action, onAction, right, testID }: { title: string; action?: string; onAction?: () => void; right?: React.ReactNode; testID?: string }) {
  return (
    <View style={s.section} testID={testID}>
      <Text style={[type.h2, { color: colors.text, flexShrink: 1 }]} accessibilityRole="header">
        {title}
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>{right}</View>
      {action && onAction && (
        <PressableScale onPress={onAction} accessibilityRole="button" style={s.sectionLink} hitSlop={6}>
          <Text style={s.sectionLinkText}>{action}</Text>
        </PressableScale>
      )}
    </View>
  );
}

export function ProgressBar({ value, testID, thumb }: { value: number; testID?: string; thumb?: boolean }) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={s.track} testID={testID} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      <LinearGradient colors={gradients.progress as unknown as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.fill, { width: `${v * 100}%` }]} />
      {thumb && v > 0 && <View style={[s.thumb, { left: `${v * 100}%` }]} />}
    </View>
  );
}

/** Grey block that gently pulses (static with Reduce Motion). */
export function Skeleton({ w, h, r = radius.sm, style }: { w?: number | `${number}%`; h: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (!reduce) v.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [reduce, v]);
  const st = useAnimatedStyle(() => ({ opacity: 1 - 0.45 * v.value }));
  return <Animated.View style={[{ width: w ?? '100%', height: h, borderRadius: r, backgroundColor: palette.grey200 }, st, style]} />;
}

/** Empty state (design-spec §7): icon tile, what's missing, why it helps, one primary CTA. */
export function EmptyCard({ icon, title, text, cta, onCta, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string; cta?: string; onCta?: () => void; testID?: string }) {
  return (
    <View style={s.empty} testID={testID}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={36} color={colors.ink} />
      </View>
      <Text style={[type.h3, { color: colors.text, textAlign: 'center', marginTop: 10 }]}>{title}</Text>
      {text ? <Text style={[type.body, { color: colors.muted, textAlign: 'center', marginTop: 4 }]}>{text}</Text> : null}
      {cta && onCta && (
        <PressableScale onPress={onCta} accessibilityRole="button" style={s.emptyCta} testID={testID ? `${testID}-cta` : undefined}>
          <Ionicons name="add-circle" size={18} color={colors.onPrimary} />
          <Text style={[type.button, { color: colors.onPrimary }]}>{cta}</Text>
        </PressableScale>
      )}
    </View>
  );
}

export const card = { backgroundColor: colors.white, borderRadius: radius.md, padding: 14, ...elevation.e2 } as const;

const s = StyleSheet.create({
  glass: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  glassDot: { position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.ink },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', alignSelf: 'flex-start' },
  tagText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  section: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  sectionLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  sectionLinkText: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.grey200, overflow: 'visible', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: colors.white, borderWidth: 3, borderColor: colors.primary },
  empty: { ...card, alignItems: 'center', paddingVertical: 22 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, height: 48, paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.primary, ...elevation.glowPrimary },
});
