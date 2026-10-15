/**
 * 1.4.22 Day/Night screen kit – the spec v2 §2/§3 visual language as RN primitives. Colours ONLY from useTheme().t.
 *  Day "Sunday Court": 2px ink borders, hard offset ink shadows (drawn as a View – elevation 0), tilted stickers, blobs.
 *  Night "Floodlight": 1px outline, no shadow, volt glow on primary only, glow blobs and a floodlight beam.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient as SvgGrad, Path, Polygon, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { useHiFont } from '../theme/useHiFont';
import type { Tokens } from '../theme/tokens';

export function useKit() {
  const { t, name } = useTheme();
  const f = useHiFont();
  return { t, name, day: name === 'day', f };
}

/** Ink offset shadow + border wrapper (spec shadow.card 4 4 0 / shadow.btn 3 3 0). Night: plain border, optional highlight. */
export function Sticker({ children, style, fill, shadow, radius, tilt, highlight, testID, onPress, accessibilityLabel, inner, border }: {
  children?: React.ReactNode; style?: StyleProp<ViewStyle>; inner?: StyleProp<ViewStyle>; fill?: string; shadow?: number; radius?: number; tilt?: number;
  highlight?: boolean; testID?: string; onPress?: () => void; accessibilityLabel?: string; border?: string;
}) {
  const { t, day } = useKit();
  const r = radius ?? t.radius.card;
  const off = day ? (shadow ?? t.shadow.card) : 0;
  const bg = fill ?? (highlight && day ? t.accent : t.surface);
  const bc = border ?? (highlight && !day ? t.primary : day ? t.outline : t.surface2);
  const body = (
    <View style={[{ backgroundColor: bg, borderRadius: r, borderWidth: day ? t.border.card : highlight ? 2 : 1, borderColor: bc, overflow: 'hidden' }, inner]}>{children}</View>
  );
  const wrap: ViewStyle = { marginRight: off, marginBottom: off, ...(tilt ? { transform: [{ rotate: `${tilt}deg` }] } : null) };
  const shadowView = off ? <View pointerEvents="none" style={{ position: 'absolute', left: off, top: off, right: -off, bottom: -off, borderRadius: r, backgroundColor: t.outline }} /> : null;
  if (onPress)
    return (
      <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ pressed }) => [wrap, style, pressed && { transform: [{ scale: 0.98 }, ...(tilt ? [{ rotate: `${tilt}deg` }] : [])] }]}>
        {shadowView}{body}
      </Pressable>
    );
  return <View style={[wrap, style]} testID={testID}>{shadowView}{body}</View>;
}

/** Display type: Day Baloo 2 800; Night Teko 600 UPPERCASE (Hindi: Mukta 800 sentence case, no tracking). */
export function Display({ children, size = 26, color, style, numberOfLines, testID, accessibilityRole }: { children: React.ReactNode; size?: number; color?: string; style?: StyleProp<TextStyle>; numberOfLines?: number; testID?: string; accessibilityRole?: 'header' }) {
  const { t, day, f } = useKit();
  const s = day || !f.upper ? size : Math.round(size * 1.18); // Teko is condensed: the mockups set it ~18 % larger
  return (
    <Text testID={testID} accessibilityRole={accessibilityRole} numberOfLines={numberOfLines}
      style={[{ color: color ?? t.text, fontSize: s, lineHeight: Math.round(s * (f.upper ? 1.0 : 1.2)), fontWeight: '800' }, f.display, f.upper && { textTransform: 'uppercase', letterSpacing: 0.5 }, style]}>
      {children}
    </Text>
  );
}
/** Overline: Day Hind 700 12 tracked caps; Night Teko 15 tracked caps (Hindi: bold 13, no caps). */
export function Over({ children, color, style, testID, numberOfLines }: { children: React.ReactNode; color?: string; style?: StyleProp<TextStyle>; testID?: string; numberOfLines?: number }) {
  const { t, day, f } = useKit();
  const hiNight = !day && !f.upper;
  return (
    <Text testID={testID} numberOfLines={numberOfLines} style={[{ color: color ?? t.textMuted, fontSize: day ? 12 : 15, letterSpacing: day ? 1 : 1.6, textTransform: 'uppercase', fontWeight: '700' }, day ? f.bold : f.display, hiNight && { fontSize: 13, letterSpacing: 0, textTransform: 'none' }, style]}>
      {children}
    </Text>
  );
}
export function Body({ children, color, size = 14, bold, muted, style, numberOfLines, testID }: { children: React.ReactNode; color?: string; size?: number; bold?: boolean; muted?: boolean; style?: StyleProp<TextStyle>; numberOfLines?: number; testID?: string }) {
  const { t, f } = useKit();
  return (
    <Text testID={testID} numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? t.textMuted : t.text), fontSize: size, lineHeight: Math.round(size * 1.4), fontWeight: bold ? '700' : '400' }, bold ? f.bold : f.body, style]}>
      {children}
    </Text>
  );
}

/** Button (spec §3): h52, primary/secondary. Day ink border + hard shadow; Night volt glow on primary. */
export function KButton({ title, icon, onPress, variant = 'p', testID, disabled, loading, style, accessibilityLabel }: {
  title: string; icon?: keyof typeof Ionicons.glyphMap; onPress?: () => void; variant?: 'p' | 's'; testID?: string; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const { t, day, f } = useKit();
  const p = variant === 'p';
  // 1.4.23 (V1422-4): a disabled button keeps readable text (muted on surface2) instead of fading to 45% opacity.
  const bg = disabled ? t.surface2 : p ? t.primary : day ? t.surface : t.surface2;
  const fg = disabled ? t.textMuted : p ? t.onPrimary : t.text;
  const off = day ? t.shadow.btn : 0;
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [{ marginRight: off, marginBottom: off, opacity: 1 }, style, pressed && { transform: [{ scale: 0.97 }] }]}>
      {({ pressed }) => (
        <>
          {off && !pressed ? <View style={{ position: 'absolute', left: off, top: off, right: -off, bottom: -off, borderRadius: t.radius.btn, backgroundColor: t.outline }} /> : null}
          <View style={[{ minHeight: 52, borderRadius: t.radius.btn, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
            day ? { borderWidth: 2, borderColor: t.outline } : p ? null : { borderWidth: 1, borderColor: t.outline },
            !day && p && t.shadow.glow ? { shadowColor: t.primary, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } } : null,
            pressed && day ? { transform: [{ translateX: off }, { translateY: off }] } : null]}>
            {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
            <Text style={[{ color: fg, fontSize: day ? 17 : 22, fontWeight: '800', textAlign: 'center', flexShrink: 1 }, f.display, f.upper && { textTransform: 'uppercase', letterSpacing: 1 }, !day && !f.upper && { fontSize: 18 }]}>{title}</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

/** Icon button 48 (spec §3): Day circle with ink border; Night rounded-16 surface. Badge dot 8. */
export function IconBtn({ icon, onPress, label, testID, dot, size = 48 }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; label: string; testID?: string; dot?: boolean; size?: number }) {
  const { t, day } = useKit();
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: day ? size / 2 : 16, backgroundColor: t.surface, borderWidth: day ? 2 : 1, borderColor: day ? t.outline : t.surface2, alignItems: 'center', justifyContent: 'center' }, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Ionicons name={icon} size={22} color={t.text} />
      {dot ? <View style={{ position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: day ? t.primary : t.primary, borderWidth: day ? 1 : 0, borderColor: t.outline }} /> : null}
    </Pressable>
  );
}

/** LIVE badge (spec §3): h22–24, dot 7. */
export function LivePill({ text, testID }: { text: string; testID?: string }) {
  const { t, day, f } = useKit();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: day ? 24 : 22, paddingHorizontal: day ? 9 : 8, borderRadius: day ? 12 : 6, backgroundColor: t.live, alignSelf: 'flex-start', ...(day ? { borderWidth: 2, borderColor: t.outline } : null) }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.onLive }} />
      <Text style={[{ color: t.onLive, fontSize: day ? 11 : 16, fontWeight: '700', letterSpacing: day ? 0.6 : 1 }, day ? f.bold : f.display, f.upper || day ? { textTransform: 'uppercase' } : { fontSize: 12 }]}>{text}</Text>
    </View>
  );
}

/** Score numeral: Day = Baloo 2 800 on a tilted white sticker; Night = Teko 600 tabular in team colour. */
export function ScoreNum({ value, color, size = 54, tilt = -3, testID, accessibilityLabel }: { value: number | string; color?: string; size?: number; tilt?: number; testID?: string; accessibilityLabel?: string }) {
  const { t, day } = useKit();
  if (day)
    return (
      <Sticker radius={16} shadow={3} tilt={tilt} testID={testID} inner={{ paddingHorizontal: 12, paddingTop: 4, minWidth: size * 0.95, alignItems: 'center' }}>
        <Text accessibilityLabel={accessibilityLabel} style={{ fontFamily: t.font.score, fontSize: size, lineHeight: Math.round(size * 1.05), color: t.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
      </Sticker>
    );
  return <Text testID={testID} accessibilityLabel={accessibilityLabel} style={{ fontFamily: t.font.score, fontSize: size * 1.18, lineHeight: Math.round(size * 1.05), color: color ?? t.text, fontVariant: ['tabular-nums'] }}>{value}</Text>;
}

/** Chip (spec §3): h36 visual, hit 48. on: Day ink + Ball text; Night Volt + ink. */
export function KChip({ label, on, onPress, testID, icon }: { label: string; on?: boolean; onPress?: () => void; testID?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const { t, day, f } = useKit();
  const bg = on ? (day ? t.text : t.primary) : day ? t.surface : t.surface2;
  const fg = on ? (day ? t.accent : t.onPrimary) : t.text;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }} hitSlop={6}
      style={{ height: 36, paddingHorizontal: 14, borderRadius: t.radius.chip, backgroundColor: bg, borderWidth: day ? 2 : 0, borderColor: t.outline, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={[{ color: fg, fontSize: 13, fontWeight: '700' }, f.bold]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Decor: Day blob (soft shape) / Night glow (blurred-looking concentric circles) – purely decorative, a11y hidden. */
export function Blob({ color, size, style }: { color: string; size: number; style?: StyleProp<ViewStyle> }) {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}
export function Glow({ color, size, style, opacity = 0.35 }: { color: string; size: number; style?: StyleProp<ViewStyle>; opacity?: number }) {
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGrad id="g" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity={opacity} /><Stop offset="1" stopColor={color} stopOpacity={opacity} /></SvgGrad>
        </Defs>
        {[1, 0.75, 0.5].map((k, i) => <Circle key={i} cx={size / 2} cy={size / 2} r={(size / 2) * k} fill={color} opacity={opacity / 3} />)}
      </Svg>
    </View>
  );
}
/** Night floodlight beam (spec decor): volt cone fading down. */
export function Beam({ width = 240, height = 320, color, style }: { width?: number; height?: number; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', width, height }, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <SvgGrad id="beam" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity={0.3} /><Stop offset="0.75" stopColor={color} stopOpacity={0} /></SvgGrad>
        </Defs>
        <Polygon points={`${width * 0.44},0 ${width * 0.56},0 ${width},${height} 0,${height}`} fill="url(#beam)" />
      </Svg>
    </View>
  );
}

/** Greeting art tile 52 (spec §5), one SVG per variant, recoloured by tokens. */
export function GreetArt({ kind, size = 52, testID }: { kind: 'morning' | 'afternoon' | 'evening' | 'night'; size?: number; testID?: string }) {
  const { t, day } = useKit();
  const sky = { morning: ['#FFD9A8', '#FFF4E2'], afternoon: ['#8ED8F8', '#E6F7FD'], evening: ['#6B3FA0', '#FF8A3D'], night: ['#0A0E1A', '#1B1446'] }[kind];
  const sunY = { morning: 34, afternoon: 18, evening: 36, night: 70 }[kind];
  return (
    <View testID={testID ?? `greet-art-${kind}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: day ? 14 : 14, overflow: 'hidden', borderWidth: day ? 2 : 0, borderColor: t.outline }}>
      <Svg width={size} height={size} viewBox="0 0 52 52">
        <Defs><SvgGrad id={`sky-${kind}`} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={sky[0]} /><Stop offset="1" stopColor={sky[1]} /></SvgGrad></Defs>
        <Rect width="52" height="52" fill={`url(#sky-${kind})`} />
        {kind === 'night' ? (
          <>
            {[[8, 8], [20, 5], [44, 10], [36, 4]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={0.9} fill="#F4F7FF" />)}
            <Polygon points="10,10 14,10 26,40 0,40" fill="#C6FF1A" opacity={0.25} />
            <Polygon points="38,10 42,10 52,40 26,40" fill="#C6FF1A" opacity={0.25} />
            <Line x1="12" y1="10" x2="12" y2="40" stroke="#A3AFCB" strokeWidth={1.5} />
            <Line x1="40" y1="10" x2="40" y2="40" stroke="#A3AFCB" strokeWidth={1.5} />
          </>
        ) : (
          <Circle cx="26" cy={sunY} r="9" fill={kind === 'evening' ? '#FFC531' : '#FFC531'} stroke={day ? t.outline : 'none'} strokeWidth={1.5} />
        )}
        <Rect y="38" width="52" height="14" fill={kind === 'night' ? '#232C47' : '#FF6A13'} />
        <Line x1="4" y1="40" x2="48" y2="40" stroke={kind === 'evening' || kind === 'night' ? '#C6FF1A' : '#FFFFFF'} strokeWidth={1.5} />
        {kind !== 'night' ? <Path d="M26 38 V30" stroke="#1B1340" strokeWidth={1.5} /> : null}
      </Svg>
    </View>
  );
}

/** Dashed (Day) / solid (Night) list divider (spec §3 List row). */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t, day } = useKit();
  return <View style={[{ height: 0, borderTopWidth: day ? 1.5 : 1, borderStyle: day ? 'dashed' : 'solid', borderColor: day ? t.outline : t.surface2, opacity: day ? 0.35 : 1 }, style]} />;
}

/** Contrast helper for team fills: Day white on teal / ink on orange; Night ink on both neons. */
export function onTeam(t: Tokens, side: 'A' | 'B') { return side === 'A' ? t.onPrimary : t.onTeamB; }

export const kitStyles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
