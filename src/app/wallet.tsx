/**
 * Points wallet (1.3.0): the balance only. Points are in-app, derived from COUNTED matches
 * (src/core/antifraud.ts playerWallet) plus the derived win bonus. There is deliberately no redeem,
 * withdraw, transfer or money wording anywhere (decision: no real-money conversion).
 * 1.3.1 (QA C130-7): a points history list, derived from the same counted matches and win bonuses
 * (core/antifraud.ts walletHistory); nothing is stored.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Skeleton } from '../components/Hero';
import { ANTI_FRAUD, type WalletHistoryItem } from '../core/antifraud';
import { RANKING_POINTS_PER_POTM, RANKING_POINTS_PER_WIN } from '../core/ranking';
import { formatWhenT } from '../i18n/format';
import { backend, type WalletResult } from '../services/backend';
import { useMe } from '../state/AuthContext';
import { colors, gradients, radius, type, themed } from '../theme';

export default function WalletScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const [w, setW] = useState<WalletResult | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    backend.getWallet(me.id).then((x) => alive && setW(x)).catch(() => alive && setW(null));
    return () => {
      alive = false;
    };
  }, [me.id]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="wallet-screen">
      {w === undefined ? (
        <Skeleton h={140} r={16} />
      ) : (
        <>
          <LinearGradient colors={gradients.hero as unknown as [string, string, string]} style={s.hero}>
            <Text style={s.label}>{t('wallet.balance')}</Text>
            <Text style={s.balance} testID="wallet-balance" accessibilityLabel={`${t('wallet.balance')}: ${t('wallet.pts', { n: w?.balance ?? 0 })}`}>
              {t('wallet.pts', { n: w?.balance ?? 0 })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="lock-closed" size={13} color={colors.onInkMuted} />
              <Text style={s.note}>{t('wallet.inAppOnly')}</Text>
            </View>
          </LinearGradient>
          <View style={s.card}>
            <Line label={t('wallet.matchPoints')} value={t('wallet.pts', { n: w?.matchPoints ?? 0 })} testID="wallet-match-points" />
            <Line label={t('wallet.bonus')} value={t('wallet.pts', { n: w?.bonus ?? 0 })} testID="wallet-bonus" />
            <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>
              {t('wallet.bonusRule', { points: ANTI_FRAUD.BONUS_POINTS, every: ANTI_FRAUD.BONUS_EVERY_WINS })} · {t('wallet.nextBonus', { n: w?.winsToNextBonus ?? ANTI_FRAUD.BONUS_EVERY_WINS })}
            </Text>
          </View>
          <View style={s.card}>
            <Line label={t('wallet.counted')} value={String(w?.countedMatches ?? 0)} testID="wallet-counted" />
            <Line label={t('wallet.wins')} value={String(w?.wins ?? 0)} />
            <Line label={t('wallet.awaiting')} value={String(w?.awaitingConfirmation ?? 0)} testID="wallet-awaiting" />
            <Line label={t('wallet.flagged')} value={String(w?.flagged ?? 0)} testID="wallet-flagged" />
            <Text style={[type.caption, { color: colors.muted, marginTop: 6 }]}>{t('wallet.pendingNote')}</Text>
          </View>
          <View style={s.card} testID="wallet-history">
            <Text style={[type.h3, { color: colors.text, marginBottom: 4 }]} accessibilityRole="header">
              {t('wallet.history')}
            </Text>
            {(w?.history ?? []).length === 0 ? (
              <Text style={[type.caption, { color: colors.muted }]} testID="wallet-history-empty">
                {t('wallet.historyEmpty')}
              </Text>
            ) : (
              (w?.history ?? []).map((h, i) => <HistoryRow key={`${h.kind}-${h.matchId}`} h={h} first={i === 0} />)
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function HistoryRow({ h, first }: { h: WalletHistoryItem; first: boolean }) {
  const { t } = useTranslation();
  const title = h.kind === 'bonus' ? t('wallet.historyBonus', { n: h.wins }) : t('wallet.historyVs', { team: h.opponent });
  const tags = h.kind === 'match' ? [h.won ? t('wallet.historyWin') : t('wallet.historyLoss'), h.potm ? t('potm.title') : null, t('wallet.historyCredited', { n: h.credited })].filter(Boolean).join(' · ') : t('wallet.bonus');
  const pts = `+${t('wallet.pts', { n: h.points })}`;
  // 1.3.5 (QA INFO): how the row's points add up, e.g. "6 pts + 10 win + 25 POTM".
  const breakdown =
    h.kind === 'match'
      ? [
          t('wallet.breakdownPts', { n: h.credited }),
          h.won ? t('wallet.breakdownWin', { n: RANKING_POINTS_PER_WIN }) : null,
          h.potm ? t('wallet.breakdownPotm', { n: RANKING_POINTS_PER_POTM }) : null,
        ]
          .filter(Boolean)
          .join(' + ')
      : null;
  return (
    <View style={[s.hRow, !first && s.hDivider]} accessible accessibilityLabel={`${title}. ${tags}. ${formatWhenT(h.at)}. ${pts}${breakdown ? ` (${breakdown})` : ''}`} testID={`wallet-history-${h.kind}-${h.matchId}`}>
      <View style={[s.hIcon, h.kind === 'bonus' && { backgroundColor: colors.warnBg }]}>
        <Ionicons name={h.kind === 'bonus' ? 'gift-outline' : h.won ? 'trophy-outline' : 'tennisball-outline'} size={16} color={colors.text} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: colors.text, fontWeight: '700' }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[type.caption, { color: colors.muted }]} numberOfLines={2}>
          {tags} · {formatWhenT(h.at)}
        </Text>
        {breakdown ? (
          <Text style={[type.caption, { color: colors.text, fontWeight: '700' }]} numberOfLines={2} testID={`wallet-breakdown-${h.matchId}`}>
            {breakdown}
          </Text>
        ) : null}
      </View>
      <Text style={[type.body, { color: colors.success, fontWeight: '800' }]}>{pts}</Text>
    </View>
  );
}

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={s.line} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={[type.body, { color: colors.text, flex: 1 }]}>{label}</Text>
      <Text style={[type.body, { color: colors.text, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 20, gap: 6 },
  label: { color: colors.onInkMuted, fontSize: 13, fontWeight: '700' },
  balance: { color: colors.white, fontSize: 40, fontWeight: '900' },
  note: { color: colors.onInkMuted, fontSize: 13, fontWeight: '600', flex: 1 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.hairline },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, minHeight: 48 },
  hDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  hIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, minHeight: 40 },
}));
