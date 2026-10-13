/**
 * 1.4.8 (QA V147-2): an admin outside the match repairs a match nobody can confirm – a new scorer, or (1.4.10, V149-3: only for a side whose captain plays for the other team) a new captain of
 * one side who will confirm (core/verdictRepair.ts repairOptions: only the choices that leave someone to confirm).
 * Each choice asks first (confirmAsk); the backend checks it again (lifecycle 'repairVerdict', audited in verdictRepair).
 */
import React, { useEffect, useState } from 'react';
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

/** How long the "repaired" state stays before the card goes (1.4.12, QA V1411-4). */
export const REPAIRED_MS = 4000;
/** 1.4.15 (QA V1414-3): the state's REPAIRED_MS run from when it is first SHOWN, not from the repair call's return – a
 * card that (re-)mounted later (the page reloading the match on a slower device) showed what was left, ~2.4 s. Until
 * shown it is kept at most REPAIRED_UNSHOWN_MS. */
export const REPAIRED_UNSHOWN_MS = 15000;
const REPAIRED_AT = new Map<string, { at: number; shownAt: number | null }>();
/** A repair of this match is still in its "repaired" state (survives the card re-mounting). */
export const repairedRecently = (id: string, now = Date.now()): boolean => {
  const e = REPAIRED_AT.get(id);
  return !!e && (e.shownAt == null ? now - e.at < REPAIRED_UNSHOWN_MS : now - e.shownAt < REPAIRED_MS);
};
/** The card has painted the "repaired" state (the REPAIRED_MS start once). */
const markShown = (id: string, now = Date.now()): void => {
  const e = REPAIRED_AT.get(id);
  if (e && e.shownAt == null) e.shownAt = now;
};

export function VerdictRepairCard({ match: m, meId, isAdmin, nameOf, onChanged, testID = 'verdict-repair' }: {
  match: Match; meId: string; isAdmin: boolean; nameOf: (uid: string) => string | undefined; onChanged?: () => void; testID?: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  // 1.4.13 (QA V1412-5): the "repaired" state lives outside the component (per match, with its time) – the match page /
  // admin list re-mount the card when the repaired match arrives, which lost a local flag within ~1 s
  const [, tick] = useState(0);
  const done = repairedRecently(m.id);
  const setDone = (on: boolean) => { if (on) REPAIRED_AT.set(m.id, { at: Date.now(), shownAt: null }); else REPAIRED_AT.delete(m.id); tick((x) => x + 1); };
  // 1.4.12 (QA V1411-4): the confirmed repair shows a short "repaired" state (no old title, no stale chips), then the
  // card goes – it stays only while the match still needs a repair (the watched / reloaded match decides), no reload
  useEffect(() => {
    if (!done) return;
    markShown(m.id); // (effects run after the commit: the state is on screen)
    // re-checked every 250 ms (another mount of the card may have set / cleared it): goes once REPAIRED_MS have passed
    const t = setInterval(() => { if (!repairedRecently(m.id)) { REPAIRED_AT.delete(m.id); tick((x) => x + 1); } }, 250);
    return () => clearInterval(t);
  }, [done, m.id]);
  const shows = showsVerdictRepair(m, meId, isAdmin);
  if (!shows && !done) return null;
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
      {done ? (
        <Text style={[type.h3, { color: colors.text }]} accessibilityRole="alert" testID={`${testID}-done`}>{t('abandon.repairedToast')}</Text>
      ) : (
        <>
        <Text style={[type.h3, { color: colors.text }]} testID={`${testID}-title`}>{t('abandon.repairTitle')}</Text>
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
        </>
      )}
      {error ? <Text style={{ color: colors.danger, marginTop: 4 }} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Text> : null}
    </Card>
    </View>
  );
}

/** Tests only: forget every "repaired" state (it lives at module level so it survives re-mounts). */
export const resetRepairedForTests = (): void => REPAIRED_AT.clear();
