/**
 * 1.3.7 (R136-20): "Sub" opens a real substitution sheet: pick the team, the court player going off
 * and the bench player coming on; the bench player takes the same court position. Saved into this
 * set's lineup (same storage as the lineup picker), so it is available before the first rally of a
 * set – mid-set substitutions would need a new event type on every backend (not in 1.3.7).
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from './AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import type { SideLineups } from '../core/rotation';
import type { Side } from '../core/scoring';
import type { Match } from '../core/types';
import { colors, onColor, teamText } from '../theme';
import { Button } from './ui';

/** Replace `off` (on court) with `on` (bench) at the same position. Unchanged if either is invalid. */
export function substitute(lineup: SideLineups, side: Side, off: string, on: string): SideLineups {
  const cur = lineup[side];
  const at = cur.indexOf(off);
  if (at < 0 || cur.includes(on)) return lineup;
  const next = cur.slice();
  next[at] = on;
  return { ...lineup, [side]: next };
}

export function SubSheet({ visible, match, setNumber, initial, onSave, onClose }: { visible: boolean; match: Match; setNumber: number; initial: SideLineups; onSave: (l: SideLineups) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [lineup, setLineup] = useState<SideLineups>(initial);
  const [side, setSide] = useState<Side>('A');
  const [off, setOff] = useState<string | null>(null);
  const [on, setOn] = useState<string | null>(null);
  const [made, setMade] = useState<string[]>([]);
  useEffect(() => {
    if (visible) {
      setLineup(initial);
      setOff(null);
      setOn(null);
      setMade([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const team = side === 'A' ? match.teamA : match.teamB;
  const name = (id: string) => team.players.find((p) => p.id === id)?.name ?? id;
  const court = lineup[side].filter((x): x is string => !!x);
  const bench = team.players.map((p) => p.id).filter((id) => !lineup[side].includes(id));
  const chip = (id: string, selected: boolean, onPress: () => void, testID: string) => (
    <Pressable key={id} onPress={onPress} testID={testID} accessibilityRole="button" accessibilityState={{ selected }} style={[s.chip, selected && { backgroundColor: team.color, borderColor: team.color }]}>
      <Text style={[s.chipText, selected && { color: onColor(team.color) }]} numberOfLines={1}>
        {name(id)}
      </Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.bg}>
        <View style={s.sheet} testID="sub-sheet">
          <ScrollView contentContainerStyle={{ padding: 18 }}>
            <Text style={s.title}>{t('sub.title', { n: setNumber })}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
              {(['A', 'B'] as Side[]).map((x) => {
                const tm = x === 'A' ? match.teamA : match.teamB;
                return (
                  <Pressable key={x} onPress={() => (setSide(x), setOff(null), setOn(null))} testID={`sub-team-${x}`} accessibilityRole="tab" accessibilityState={{ selected: side === x }}
                    style={[s.tab, side === x && { borderColor: tm.color, backgroundColor: colors.selectedBg }]}>
                    <Text style={[s.tabText, { color: teamText(tm.color) }]} numberOfLines={1}>{tm.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.label}>{t('sub.off')}</Text>
            <View style={s.chips}>{court.map((id) => chip(id, off === id, () => setOff(off === id ? null : id), `sub-off-${id}`))}</View>
            <Text style={s.label}>{t('sub.on')}</Text>
            {bench.length ? (
              <View style={s.chips}>{bench.map((id) => chip(id, on === id, () => setOn(on === id ? null : id), `sub-on-${id}`))}</View>
            ) : (
              <Text style={s.hint} testID="sub-no-bench">{t('sub.noBench')}</Text>
            )}
            <Button
              title={t('sub.make')}
              icon="swap-horizontal"
              disabled={!off || !on}
              testID="sub-make"
              onPress={() => {
                if (!off || !on) return;
                setLineup(substitute(lineup, side, off, on));
                setMade((m) => [...m, t('sub.madeLine', { team: team.name, on: name(on), off: name(off) })]);
                setOff(null);
                setOn(null);
              }}
            />
            {made.map((x, i) => (
              <Text key={i} style={s.hint} testID={`sub-made-${i}`}>✓ {x}</Text>
            ))}
            <Button title={t('sub.save')} icon="checkmark" testID="sub-save" disabled={!made.length} onPress={() => onSave(lineup)} style={{ marginTop: 10 }} />
            <Button title={t('common.cancel')} variant="ghost" onPress={onClose} testID="sub-cancel" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' },
  hint: { fontSize: 13, color: colors.muted, marginTop: 6 },
  tab: { flex: 1, borderWidth: 2, borderColor: colors.border, borderRadius: 12, paddingVertical: 10, alignItems: 'center', minHeight: 44 },
  tabText: { fontWeight: '800', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, justifyContent: 'center', maxWidth: '100%' },
  chipText: { fontWeight: '700', color: colors.text },
});
