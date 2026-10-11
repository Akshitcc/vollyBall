/**
 * 1.3.7 Home "Fact of the day": one item per IST calendar day (deterministic, core/dailyItems.ts
 * pickDaily); tap the card for the next item; Share uses the system share sheet (web: copies, 1.3.8).
 * Admin items from the backend are merged with the bundled facts; offline the bundled list is used.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { card } from './Hero';
import { PressableScale } from './PressableScale';
import { BUNDLED_DAILY_ITEMS, dailyAttribution, mergeDailyItems, msUntilNextIstDay, pickDaily, type DailyItem } from '../core/dailyItems';
import { backend } from '../services/backend';
import { shareOrCopy } from '../services/share';
import { colors, overlineFor, type } from '../theme';

export function dailyText(item: DailyItem, lang: string): string {
  return lang === 'hi' ? item.textHi : item.textEn;
}

/** "text — attribution" for sharing (quotes always keep their attribution). */
export function shareMessage(item: DailyItem, lang: string): string {
  const who = item.type === 'quote' && item.attribution ? ` — ${item.attribution}` : '';
  return `${dailyText(item, lang)}${who}\n\n#VolleyLive`;
}

export function DailyCard({ now, items: given }: { now?: number; items?: readonly DailyItem[] } = {}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<readonly DailyItem[]>(given ?? BUNDLED_DAILY_ITEMS);
  const [offset, setOffset] = useState(0);
  // 1.3.8 (V137-3): re-render at the IST midnight rollover while the screen stays open (new day's item)
  const [clock, setClock] = useState(() => now ?? Date.now());
  useEffect(() => {
    if (now != null) return;
    const id = setTimeout(() => {
      setOffset(0);
      setClock(Date.now());
    }, msUntilNextIstDay(clock) + 1000);
    return () => clearTimeout(id);
  }, [clock, now]);
  useEffect(() => {
    if (given) return;
    let live = true;
    if (typeof backend.listDailyItems !== 'function') return;
    backend
      .listDailyItems()
      .then((list) => {
        // 1.3.8 (V137-3): admin items are added to the bundled facts, not instead of them
        if (live) setItems(mergeDailyItems(list));
      })
      .catch(() => undefined); // offline: keep the bundled list
    return () => {
      live = false;
    };
  }, [given]);
  const item = pickDaily(items, now ?? clock, offset);
  if (!item) return null;
  const lang = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const title = item.type === 'quote' ? t('daily.quoteTitle') : t('daily.factTitle');
  return (
    <View style={[card, { marginTop: 14 }]} testID="daily-card">
      <PressableScale
        onPress={() => setOffset((o) => o + 1)}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${dailyText(item, lang)}`}
        accessibilityHint={t('daily.nextHint')}
        testID="daily-next"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={item.type === 'quote' ? 'chatbubble-ellipses-outline' : 'bulb-outline'} size={18} color={colors.primaryText} />
          <Text style={[overlineFor(lang), { color: colors.primaryText, flex: 1 }]}>{title}</Text>
          <Text style={[type.caption, { color: colors.muted }]}>{t('daily.tapNext')}</Text>
        </View>
        <Text style={[type.body, { color: colors.text, marginTop: 8, fontWeight: '600' }]} testID="daily-text">
          {dailyText(item, lang)}
        </Text>
        {item.attribution ? (
          <Text style={[type.caption, { color: colors.muted, marginTop: 6 }]} testID="daily-attribution">
            {item.type === 'quote' ? `— ${dailyAttribution(item, lang)}` : t('daily.source', { source: dailyAttribution(item, lang) })}
          </Text>
        ) : null}
      </PressableScale>
      <PressableScale
        onPress={() => void shareOrCopy(shareMessage(item, lang))}
        accessibilityRole="button"
        accessibilityLabel={t('daily.share')}
        testID="daily-share"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginTop: 8, minHeight: 40, paddingHorizontal: 8 }}
      >
        <Ionicons name="share-social-outline" size={18} color={colors.primaryText} />
        <Text style={{ color: colors.primaryText, fontWeight: '700' }}>{t('daily.share')}</Text>
      </PressableScale>
    </View>
  );
}
