/**
 * 1.4.21 Day/Night component kit (spec v2 §3) – colours ONLY from useTheme().t:
 *  SegmentedControl (h52 outer, items h44; selected: day ink + Ball text, night Volt + ink),
 *  StepDots (dots 10, active 28 wide, "Step n of N"), ReactionButton (48 circle, emoji 22, pop + "+1" float),
 *  SheetScrim (day ink@55 %, night black@72 %).
 */
import React, { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { reduceMotionNow } from '../hooks/useReduceMotion';
import { useTheme } from '../theme/ThemeProvider';
import { useHiFont } from '../theme/useHiFont';

export function SegmentedControl<K extends string>({ items, value, onChange, testID }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; testID?: string }) {
  const { t, name } = useTheme();
  const hf = useHiFont();
  return (
    <View accessibilityRole="tablist" testID={testID} style={{ height: 52, flexDirection: 'row', padding: 4, gap: 4, borderRadius: t.radius.btn, backgroundColor: t.surface2, borderWidth: t.border.card, borderColor: t.outline }}>
      {items.map((it) => {
        const on = it.key === value;
        const bg = on ? (name === 'day' ? t.text : t.primary) : 'transparent';
        const fg = on ? (name === 'day' ? t.accent : t.onPrimary) : t.text;
        return (
          <Pressable key={it.key} onPress={() => onChange(it.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={testID ? `${testID}-${it.key}` : undefined}
            style={{ flex: 1, minHeight: 42, borderRadius: t.radius.btn - 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={[{ color: fg, fontWeight: '800', fontSize: 14, textAlign: 'center' }, hf.bold]} numberOfLines={2}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StepDots({ step, total, testID }: { step: number; total: number; testID?: string }) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID={testID} accessible accessibilityLabel={tr('newMatch.stepOf', { n: step + 1, total })}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} testID={testID ? `${testID}-${i < step ? 'done' : i === step ? 'current' : 'todo'}` : undefined}
          style={{ height: 10, width: i === step ? 28 : 10, borderRadius: 5, backgroundColor: i <= step ? t.primary : t.surface2, borderWidth: 1, borderColor: t.outline }} />
      ))}
      <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>{tr('newMatch.stepOf', { n: step + 1, total })}</Text>
    </View>
  );
}

export function ReactionButton({ emoji, label, onPress, testID }: { emoji: string; label: string; onPress: () => void; testID?: string }) {
  const { t } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const [sent, setSent] = useState(0);
  const press = () => {
    onPress();
    setSent((n) => n + 1);
    if (reduceMotionNow()) return;
    scale.setValue(1.25); float.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: false, friction: 4 }),
      Animated.timing(float, { toValue: 1, duration: 700, useNativeDriver: false }),
    ]).start();
  };
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4}
      style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: t.surface, borderWidth: t.border.card, borderColor: t.outline, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.Text style={{ fontSize: 22, transform: [{ scale }] }}>{emoji}</Animated.Text>
      {sent > 0 ? (
        <Animated.Text testID={testID ? `${testID}-sent` : undefined} style={{ position: 'absolute', top: -6, right: -4, color: t.teamAText, fontWeight: '900', fontSize: 12,
          opacity: float.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }), transform: [{ translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) }] }}>+1</Animated.Text>
      ) : null}
    </Pressable>
  );
}

export function SheetScrim({ onPress, testID }: { onPress?: () => void; testID?: string }) {
  const { t } = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
