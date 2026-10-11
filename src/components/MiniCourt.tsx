/**
 * MiniCourt – a small, read-only 3×2 court showing who stands in each rotation
 * position. Used inside each team's half of the live scoring screen and on the
 * follower view. It never captures touches (pointerEvents="none"), so the big
 * "tap to score" areas behind it keep working.
 *
 * The grid is mirrored by screen side so the front row (4-3-2) is always next
 * to the net in the middle and the back row (5-6-1) is at the outside.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { courtGrid, type Slot } from '../core/rotation';
import { colors, onColor } from '../theme';

export interface MiniCourtProps {
  positions: readonly Slot[];
  /** player id → display name (shown as entered; only the first word is used). */
  names: Record<string, string>;
  server: string | null;
  screenSide: 'left' | 'right';
  teamName: string;
  variant?: 'onColor' | 'card';
  /**
   * The fill behind the court in the 'onColor' variant (the team colour on the scoring screen, ink
   * on the follower card). Text is onColor() of it: white or black, whichever reaches AA (QA
   * retest 217 #5), never a hard-coded white.
   */
  background?: string;
  testID?: string;
}

export const firstName = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

export default function MiniCourt({ positions, names, server, screenSide, teamName, variant = 'onColor', background = colors.ink, testID }: MiniCourtProps) {
  const { t } = useTranslation();
  const card = variant === 'card';
  const fg = onColor(background);
  const darkText = fg !== colors.white;
  // White text sits on a darkening scrim, black text on a lightening one (as teamInk()).
  const onFill = card ? null : darkText ? s.cellOnLight : null;
  const fgStyle = card ? null : { color: fg };
  const grid = courtGrid(screenSide);
  const netOnRight = screenSide === 'left';
  return (
    <View
      pointerEvents="none"
      testID={testID}
      accessible
      accessibilityLabel={t('rotation.courtA11y', { team: teamName })}
      style={[s.court, card ? s.courtCard : darkText ? s.courtOnLight : s.courtOnColor, netOnRight ? s.netRight : s.netLeft, card && { borderColor: colors.ink }]}
    >
      {grid.map((row, r) => (
        <View key={r} style={s.row}>
          {row.map((pos) => {
            const id = positions[pos - 1] ?? null;
            const isServer = !!id && id === server;
            return (
              <View key={pos} testID={testID ? `${testID}-p${pos}` : undefined} style={[s.cell, card ? s.cellCard : s.cellOnColor, onFill, isServer && s.cellServer]}>
                <Text style={[s.pos, fgStyle, card && { color: colors.muted }, isServer && { color: colors.ink }]}>{pos}</Text>
                <Text style={[s.name, fgStyle, card ? s.nameCard : null, isServer && { color: colors.ink }]} numberOfLines={1}>
                  {id ? firstName(names[id]) || '?' : '–'}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  court: { width: '100%', maxWidth: 220, borderRadius: 8, padding: 3, gap: 3, borderWidth: 0 },
  courtOnColor: { backgroundColor: 'rgba(0,0,0,0.22)', borderColor: 'rgba(255,255,255,0.9)' },
  courtOnLight: { backgroundColor: 'rgba(255,255,255,0.25)', borderColor: colors.ink },
  courtCard: { backgroundColor: colors.surface },
  netRight: { borderRightWidth: 3 },
  netLeft: { borderLeftWidth: 3 },
  row: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 3, minWidth: 0 },
  cellOnColor: { backgroundColor: 'rgba(0,0,0,0.18)' },
  cellOnLight: { backgroundColor: 'rgba(255,255,255,0.35)' },
  cellCard: { backgroundColor: colors.white },
  // Outline keeps the server cell visible on any team colour, including light ones (QA contrast pass).
  cellServer: { backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 2.5, paddingVertical: 1.5 },
  pos: { fontSize: 10, fontWeight: '900', marginRight: 3 },
  name: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  nameCard: { color: colors.text, fontSize: 11 },
});
