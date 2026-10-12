/**
 * LineupPicker – lets the scorer choose who starts in court positions 1–6 for
 * each team before the first rally of a set. Tap a position, then a player
 * (a player already on court swaps places). "Default order" puts the first six
 * listed players in positions 1–6.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from './AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import { COURT_SIZE, assignPosition, courtGrid, defaultLineup, type SideLineups, type Slot } from '../core/rotation';
import type { Side } from '../core/scoring';
import type { Match } from '../core/types';
import { colors, onColor, teamText } from '../theme';
import { Button } from './ui';
import { firstName } from './MiniCourt';

export interface LineupPickerProps {
  visible: boolean;
  match: Match;
  setNumber: number;
  initial: SideLineups;
  /** Which screen side each team is on, so the picker matches the scoring screen. */
  screenSide: Record<Side, 'left' | 'right'>;
  onSave: (lineup: SideLineups) => void;
  onClose: () => void;
}

export default function LineupPicker({ visible, match, setNumber, initial, screenSide, onSave, onClose }: LineupPickerProps) {
  const { t } = useTranslation();
  const [lineup, setLineup] = useState<SideLineups>(initial);
  const [sel, setSel] = useState<{ side: Side; pos: number } | null>(null);
  // Every team plays with 6 on court: all positions must be filled before saving.
  const complete = (['A', 'B'] as Side[]).every((side) => lineup[side].every((x) => x !== null));

  useEffect(() => {
    if (visible) {
      setLineup(initial);
      setSel(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const teams = (['A', 'B'] as Side[]).map((side) => ({ side, team: side === 'A' ? match.teamA : match.teamB }));

  const pick = (side: Side, playerId: string) => {
    const cur = lineup[side];
    let pos = sel?.side === side ? sel.pos : cur.findIndex((x) => x === null) + 1;
    if (pos <= 0) return; // court full and no position chosen
    const next = assignPosition(cur, pos, playerId);
    setLineup({ ...lineup, [side]: next });
    const nextEmpty = next.findIndex((x) => x === null);
    setSel(nextEmpty >= 0 ? { side, pos: nextEmpty + 1 } : null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.bg}>
        <View style={s.sheet} testID="lineup-picker">
          <ScrollView contentContainerStyle={{ padding: 18 }}>
            <Text style={s.title}>{t('rotation.title', { n: setNumber })}</Text>
            <Text style={s.hint}>{t('rotation.hint')}</Text>
            {teams.map(({ side, team }) => {
              const slots: Slot[] = lineup[side];
              const names = Object.fromEntries(team.players.map((p) => [p.id, p.name]));
              const left = screenSide[side] === 'left';
              if (!team.players.length)
                return (
                  <View key={side} style={s.team}>
                    <Text style={[s.teamName, { color: teamText(team.color) }]}>{team.name}</Text>
                    <Text style={s.hint}>{t('rotation.noPlayers')}</Text>
                  </View>
                );
              return (
                <View key={side} style={s.team}>
                  <Text style={[s.teamName, { color: teamText(team.color) }]}>{team.name}</Text>
                  <View style={[s.courtWrap, { flexDirection: left ? 'row' : 'row-reverse' }]}>
                    <View style={[s.court, { borderColor: team.color }]}>
                      {courtGrid(screenSide[side]).map((row, r) => (
                        <View key={r} style={s.row}>
                          {row.map((pos) => {
                            const id = slots[pos - 1];
                            const active = sel?.side === side && sel.pos === pos;
                            return (
                              <Pressable accessibilityRole="button"
                                key={pos}
                                testID={`lineup-${side}-p${pos}`}
                                onPress={() => setSel(active ? null : { side, pos })}
                                style={[s.slot, active && { borderColor: colors.primaryText, backgroundColor: colors.selectedBg }]}
                              >
                                <Text style={s.slotPos}>{pos}</Text>
                                <Text style={s.slotName} numberOfLines={1}>
                                  {id ? firstName(names[id]) : '–'}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                    <View style={s.net}>
                      <Text style={s.netText}>{t('rotation.net')}</Text>
                    </View>
                  </View>
                  <Text style={s.bench}>{t('rotation.bench')}</Text>
                  <View style={s.chips}>
                    {team.players.map((p) => {
                      const at = slots.indexOf(p.id);
                      return (
                        <Pressable accessibilityRole="button"
                          key={p.id}
                          testID={`lineup-${side}-player-${p.id}`}
                          onPress={() => pick(side, p.id)}
                          style={[s.chip, at >= 0 && { backgroundColor: team.color, borderColor: team.color }]}
                        >
                          <Text style={[s.chipText, at >= 0 && { color: onColor(team.color) }]} numberOfLines={1}>
                            {at >= 0 ? `${at + 1} · ` : ''}
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
            <Button
              title={t('rotation.defaultOrder')}
              variant="secondary"
              icon="refresh"
              onPress={() => {
                setLineup({ A: defaultLineup(match.teamA.players.map((p) => p.id)), B: defaultLineup(match.teamB.players.map((p) => p.id)) });
                setSel(null);
              }}
            />
            {!complete && <Text style={[s.hint, { color: colors.danger }]} testID="lineup-incomplete">{t('rotation.needSix')}</Text>}
            <Button title={t('rotation.save')} icon="checkmark" testID="lineup-save" disabled={!complete} onPress={() => complete && onSave(lineup)} />
            <Button title={t('common.cancel')} variant="ghost" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const emptyLineup = (): Slot[] => Array.from({ length: COURT_SIZE }, () => null);

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%' },
  title: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  hint: { color: colors.muted, fontWeight: '600', textAlign: 'center', marginTop: 6, marginBottom: 8 },
  team: { marginTop: 10, marginBottom: 6 },
  teamName: { fontWeight: '900', fontSize: 19, marginBottom: 6 }, // large bold; the colour is teamText()-adjusted, so legacy reds like #E53935 still reach AA
  courtWrap: { alignItems: 'stretch', alignSelf: 'center', width: '100%', maxWidth: 360 },
  court: { flex: 1, borderWidth: 2, borderRadius: 10, padding: 4, gap: 4, backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: 4 },
  slot: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 8, borderWidth: 2, borderColor: colors.border, paddingHorizontal: 6 },
  slotPos: { fontWeight: '900', color: colors.muted, marginRight: 6 },
  slotName: { fontWeight: '800', color: colors.text, flexShrink: 1 },
  net: { width: 30, backgroundColor: colors.ink, borderRadius: 4, marginHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  netText: { color: colors.white, fontWeight: '900', fontSize: 10, textAlign: 'center' },
  bench: { fontWeight: '800', color: colors.muted, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 2, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '100%' },
  chipText: { fontWeight: '800', color: colors.text },
});
