/**
 * 1.4.22 Match summary / win / POTM (spec v2 *-07-reward-win-potm): full-screen result.
 *  Day: confetti stickers, a tilted "We won!" title sticker, score stickers, Ball POTM card.
 *  Night: Volt ray burst, "VICTORY!" in Teko, neon score numerals, POTM card with a Volt border.
 * Primary action "Share the win"; "See match summary" text link. Decor is accessibility-hidden.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Display, KButton, Over, ScoreNum, Sticker, useKit } from './DNKit';

export type RewardProps = {
  title: string; // "We won!" / "Victory!" / "Delhi Smashers win"
  overline: string; // "Full time · Sunday League"
  line: string; // "Delhi Smashers beat Yamuna Blockers"
  setsA: number; setsB: number; setLines: string;
  onShare: () => void; onSummary: () => void; onClose: () => void;
  children?: React.ReactNode; // POTM picker / card
};

const CONFETTI: [number, number, number, 'primary' | 'accent' | 'teamB' | 'pink'][] = [
  [28, 70, -20, 'primary'], [300, 60, 25, 'accent'], [70, 150, 40, 'pink'], [250, 150, -35, 'teamB'], [20, 330, 15, 'accent'], [320, 300, -12, 'primary'], [150, 40, 60, 'teamB'],
];

export function RewardScreen(p: RewardProps) {
  const { t } = useTranslation();
  const k = useKit();
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: k.t.bg }]} testID="reward-screen">
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} testID={k.day ? 'reward-confetti' : 'reward-rays'}>
        {k.day ? (
          CONFETTI.map(([x, y, r, c], i) => (
            <View key={i} style={{ position: 'absolute', left: x, top: y + insets.top, width: 14, height: 22, borderRadius: 4, backgroundColor: k.t[c], borderWidth: 2, borderColor: k.t.outline, transform: [{ rotate: `${r}deg` }] }} />
          ))
        ) : (
          <Svg width="100%" height={520} viewBox="0 0 360 520">
            <Defs>
              <RadialGradient id="rg" cx="180" cy="160" r="260" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={k.t.primary} stopOpacity={0.35} />
                <Stop offset="1" stopColor={k.t.primary} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {Array.from({ length: 16 }, (_, i) => {
              const a0 = (i / 16) * Math.PI * 2, a1 = a0 + Math.PI / 32;
              const R = 520;
              return <Polygon key={i} points={`180,160 ${180 + R * Math.cos(a0)},${160 + R * Math.sin(a0)} ${180 + R * Math.cos(a1)},${160 + R * Math.sin(a1)}`} fill="url(#rg)" />;
            })}
            <Rect x="0" y="0" width="360" height="520" fill="transparent" />
          </Svg>
        )}
      </View>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={p.onClose} accessibilityRole="button" accessibilityLabel={t('score.closeResult')} hitSlop={8} testID="match-over-close"
          style={{ alignSelf: 'flex-end', width: 48, height: 48, borderRadius: k.day ? 24 : 16, backgroundColor: k.t.surface, borderWidth: k.day ? 2 : 1, borderColor: k.day ? k.t.outline : k.t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color={k.t.text} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          {k.day ? (
            <View style={{ backgroundColor: k.t.text, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 3, transform: [{ rotate: '-3deg' }] }}>
              <Text style={[{ color: k.t.accent, fontSize: 13 }, k.f.display]}>{p.overline}</Text>
            </View>
          ) : (
            <Over color={k.t.primary}>{p.overline}</Over>
          )}
          {k.day ? (
            <Sticker fill={k.t.primary} tilt={-4} shadow={5} style={{ marginTop: 12 }} inner={{ paddingHorizontal: 22, paddingVertical: 6 }}>
              <Display size={44} color={k.t.text} accessibilityRole="header" testID="reward-title" style={{ textAlign: 'center' }}>{p.title}</Display>
            </Sticker>
          ) : (
            <Display size={60} accessibilityRole="header" testID="reward-title" style={{ textAlign: 'center', marginTop: 4 }}>{p.title}</Display>
          )}
          <Body bold size={14} style={{ marginTop: 12, textAlign: 'center' }} testID="reward-line">{p.line}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 }} testID="reward-sets">
            <ScoreNum value={p.setsA} color={k.t.teamA} size={60} tilt={-3} />
            <Text style={[{ fontSize: 34, color: k.t.text }, k.f.display]}>–</Text>
            <ScoreNum value={p.setsB} color={k.t.teamB} size={60} tilt={3} />
          </View>
          <Body muted bold size={13} style={{ marginTop: 10 }}>{p.setLines}</Body>
        </View>
        {p.children}
        <KButton title={t('dn.shareWin')} icon="share-social" onPress={p.onShare} style={{ marginTop: 14 }} testID="reward-share" />
        <Pressable onPress={p.onSummary} accessibilityRole="button" style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }} testID="reward-summary">
          <Text style={[{ color: k.t.text, fontSize: 15 }, k.f.bold]}>{t('dn.seeSummary')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
