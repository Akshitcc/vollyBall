/**
 * 1.3.7 Home "Fact of the day": one item per IST calendar day (deterministic, core/dailyItems.ts
 * pickDaily); tap the card for the next item; Share uses the system share sheet (web: copies, 1.3.8).
 * Admin items from the backend are merged with the bundled facts; offline the bundled list is used.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Body, Over, Sticker, useKit } from './DNKit';
import { PressableScale } from './PressableScale';
import { BUNDLED_DAILY_ITEMS, dailyAttribution, mergeDailyItems, msUntilNextIstDay, pickDaily, type DailyItem } from '../core/dailyItems';
import { backend } from '../services/backend';
import { shareOrCopy } from '../services/share';

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
  return <DailyBody item={item} lang={lang} title={title} onNext={() => setOffset((o) => o + 1)} />;
}

/** 1.4.22 (spec v2 mockup *-01 "Fact of the day"): Day = Ball-yellow sticker card with a tilted ink label;
 *  Night = surface card, Volt bulb + Teko overline. */
function DailyBody({ item, lang, title, onNext }: { item: DailyItem; lang: string; title: string; onNext: () => void }) {
  const { t } = useTranslation();
  const k = useKit();
  const tk = k.t;
  return (
    <Sticker style={{ marginTop: k.day ? 26 : 14 }} fill={k.day ? tk.accent : tk.surface} testID="daily-card" inner={{ padding: 16, paddingTop: k.day ? 20 : 14, overflow: 'visible' }}>
      {k.day ? (
        <View style={{ position: 'absolute', top: -2, left: 14, transform: [{ rotate: '-4deg' }], backgroundColor: tk.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="daily-sticker">
          <Ionicons name={item.type === 'quote' ? 'chatbubble-ellipses' : 'bulb'} size={13} color={tk.accent} />
          <Text style={[{ color: tk.accent, fontSize: 13 }, k.f.display]}>{title}</Text>
        </View>
      ) : null}
      <PressableScale
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${dailyText(item, lang)}`}
        accessibilityHint={t('daily.nextHint')}
        testID="daily-next"
      >
        {!k.day ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name={item.type === 'quote' ? 'chatbubble-ellipses' : 'bulb'} size={16} color={tk.primary} />
            <Over color={tk.text} style={{ flex: 1 }}>{title}</Over>
            <Body muted size={12}>{t('daily.tapNext')} →</Body>
          </View>
        ) : null}
        <Body bold size={15} style={{ marginTop: k.day ? 8 : 10 }} testID="daily-text">{dailyText(item, lang)}</Body>
        {item.attribution ? (
          <Body size={12} muted={!k.day} style={{ marginTop: 6 }} testID="daily-attribution">{/* 1.4.25: muted ink is 4.26:1 on the Day Ball card */}
            {item.type === 'quote' ? `— ${dailyAttribution(item, lang)}` : t('daily.source', { source: dailyAttribution(item, lang) })}
          </Body>
        ) : null}
      </PressableScale>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        {k.day ? <Text style={[{ color: tk.text, fontSize: 13 }, k.f.bold]}>{t('daily.tapNext')} →</Text> : <View />}
        <PressableScale
          onPress={() => void shareOrCopy(shareMessage(item, lang))}
          accessibilityRole="button"
          accessibilityLabel={t('daily.share')}
          testID="daily-share"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 8 }}
        >
          <Ionicons name="share-social-outline" size={18} color={k.day ? tk.text : tk.primary} />
          <Text style={[{ color: k.day ? tk.text : tk.primary, fontWeight: '700' }, k.f.bold]}>{t('daily.share')}</Text>
        </PressableScale>
      </View>
    </Sticker>
  );
}
