/**
 * 1.4.8 (QA V147-2): an admin outside the match repairs a match nobody can confirm – a new scorer, or (1.4.10, V149-3: only for a side whose captain plays for the other team) a new captain of
 * one side who will confirm (core/verdictRepair.ts repairOptions: only the choices that leave someone to confirm).
 * Each choice asks first (confirmAsk); the backend checks it again (lifecycle 'repairVerdict', audited in verdictRepair).
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { ownMatchReview } from '../core/antifraud';
import { lifecycleStateProblem } from '../core/lifecycle';
import type { Match } from '../core/types';
import { repairOptions, type RepairFix } from '../core/verdictRepair';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { confirmAsk } from '../services/dialogs';
import { colors, type } from '../theme';
import { Card, Chip } from './ui';

/** The card shows: an admin, not their own match, and the lifecycle allows a repair now. */
export const showsVerdictRepair = (m: Match, meId: string, isAdmin: boolean): boolean =>
  isAdmin && !ownMatchReview(m, meId) && lifecycleStateProblem('repairVerdict', m) === null;

export function VerdictRepairCard({ match: m, meId, isAdmin, nameOf, onChanged, testID = 'verdict-repair' }: {
  match: Match; meId: string; isAdmin: boolean; nameOf: (uid: string) => string | undefined; onChanged?: () => void; testID?: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (!showsVerdictRepair(m, meId, isAdmin) && !done) return null;
  const opts = repairOptions(m);
  const name = (id: string) => nameOf(id) ?? id;
  const team = (side: 'A' | 'B') => (side === 'A' ? m.teamA.name : m.teamB.name);
  const run = async (fix: RepairFix) => {
    setError(null);
    const ask = 'scorerId' in fix
      ? t('abandon.repairAsk.scorer', { name: name(fix.scorerId) })
      : t('abandon.repairAsk.confirmer', { name: name(fix.captain.id), team: team(fix.captain.side) });
    if (!(await confirmAsk(ask, { title: t('abandon.repairTitle'), confirmLabel: t('common.ok'), cancelLabel: t('common.cancel') }))) return;
    try {
      await backend.repairVerdict(m.id, fix);
      setDone(true);
      onChanged?.();
    } catch (e) {
      setError(translateError(e, t));
    }
  };
  return (
    <View testID={testID}>
    <Card>
      <Text style={[type.h3, { color: colors.text }]}>{t('abandon.repairTitle')}</Text>
      {done ? (
        <Text style={[type.body, { color: colors.text, marginTop: 4 }]} testID={`${testID}-done`}>{t('abandon.repairedToast')}</Text>
      ) : (
        <>
          <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]} testID={`${testID}-hint`}>
            {/* 1.4.10 (QA V149-3): an older match whose captain plays for the other team: a new captain is the fix */}
            {opts.confirmers.length ? t('abandon.repairHintCaptain') : opts.scorers.length ? t('abandon.repairHint') : t('abandon.repairNone')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
            {opts.scorers.map((id) => (
              <Chip key={`s-${id}`} label={t('abandon.repairScorer', { name: name(id) })} testID={`${testID}-scorer-${id}`} onPress={() => void run({ scorerId: id })} />
            ))}
            {opts.confirmers.map((c) => (
              <Chip key={`c-${c.side}-${c.id}`} label={t('abandon.repairConfirmer', { name: name(c.id), team: team(c.side) })} testID={`${testID}-captain-${c.side}-${c.id}`} onPress={() => void run({ captain: c })} />
            ))}
          </View>
        </>
      )}
      {error ? <Text style={{ color: colors.danger, marginTop: 4 }} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Text> : null}
    </Card>
    </View>
  );
}
