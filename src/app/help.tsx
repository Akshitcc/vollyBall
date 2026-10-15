/**
 * 1.4.19 Profile > Help Center: searchable FAQs (EN / HI, core/helpFaq.ts), Contact us, my messages, and the support
 * email / WhatsApp links only when configured (services/supportContact.ts – no built-in contact details).
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, Text, View } from 'react-native';
import { PressableScale } from '../components/PressableScale';
import { Button, Card, Field } from '../components/ui';
import { FAQ_CATEGORIES, FAQS, searchFaqs, type Faq } from '../core/helpFaq';
import type { SupportTicket } from '../core/support';
import { formatWhenT } from '../i18n/format';
import { backend } from '../services/backend';
import { mailtoUrl, SUPPORT_URL, supportContact, whatsappUrl } from '../services/supportContact';
import { colors, type } from '../theme';

/**
 * 1.4.21 (QA V1420-6): `focus` (from /help?faq=<id>) expands the item every time it is asked for – also when the Help
 * screen was already open under Ask VolleyLive – and reports its position so the screen scrolls to it.
 */
export function FaqItem({ f, lang, initiallyOpen = false, focus = 0, onFocusLayout }: { f: Faq; lang: 'en' | 'hi'; initiallyOpen?: boolean; focus?: number; onFocusLayout?: (y: number) => void }) {
  const [open, setOpen] = useState(initiallyOpen || focus > 0);
  const y = useRef<number | null>(null);
  // the item may have been laid out before the focus arrived (the layout event does not fire again), so the last
  // known position is reported when focus changes, and again on any later layout while focused
  useEffect(() => {
    if (focus <= 0) return;
    setOpen(true);
    if (y.current != null) onFocusLayout?.(y.current);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View onLayout={(e) => { y.current = e.nativeEvent.layout.y; if (focus > 0) onFocusLayout?.(y.current); }} testID={focus > 0 ? `faq-${f.id}-focused` : `faq-${f.id}-item`}>
    <Card style={{ marginBottom: 8, padding: 12 }}>
      <PressableScale onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} testID={`faq-${f.id}`}>
        <Text style={[type.body, { fontWeight: '800', color: colors.text }]}>{f[lang].q}</Text>
      </PressableScale>
      {open ? <Text style={[type.body, { color: colors.text, marginTop: 6 }]} selectable testID={`faq-${f.id}-answer`}>{f[lang].a}</Text> : null}
    </Card>
    </View>
  );
}

/**
 * 1.4.22 (QA V1421-6): the focused FAQ item and its category report their layout in any order (on web the item often
 * comes first, before the category offset is known, which used to scroll to ~0). Keep the pending target and scroll
 * once both are known, then once more after late layout shifts (fonts, the expanded answer).
 */
export function makeFaqScroller(scrollTo: (y: number, animated: boolean) => void) {
  const catY = { current: {} as Record<string, number> };
  let pending: { cat: string; y: number } | null = null;
  const target = () => (pending && catY.current[pending.cat] != null ? Math.max(0, catY.current[pending.cat] + pending.y - 8) : null);
  const go = () => {
    if (target() == null) return;
    setTimeout(() => { const y = target(); if (y != null) scrollTo(y, true); }, 50);
    setTimeout(() => { const y = target(); if (y != null) scrollTo(y, true); }, 450);
  };
  return {
    catY,
    item: (cat: string, y: number) => { pending = { cat, y }; go(); },
    category: (cat: string, y: number) => { catY.current[cat] = y; if (pending?.cat === cat) go(); },
  };
}

export default function HelpScreen() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'hi' = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const [q, setQ] = useState('');
  // 1.4.20: Ask VolleyLive links to one FAQ (?faq=<id>) – it opens expanded
  const { faq: faqParam } = useLocalSearchParams<{ faq?: string }>();
  const scroll = useRef<ScrollView>(null);
  const [focusN, setFocusN] = useState(0);
  useEffect(() => {
    if (!faqParam) return;
    setQ(''); // the list (not a search result) holds the item
    setFocusN((n) => n + 1);
  }, [faqParam]);
  // 1.4.22 (QA V1421-6): see makeFaqScroller
  const scroller = useRef(makeFaqScroller((y, animated) => scroll.current?.scrollTo?.({ y, animated }))).current;
  const catY = scroller.catY;
  const scrollToFaq = scroller.item;
  const [mine, setMine] = useState<SupportTicket[] | null>(null);
  const contact = supportContact();
  useFocusEffect(useCallback(() => {
    backend.listMySupportTickets().then(setMine).catch(() => setMine([]));
  }, []));
  const found = useMemo(() => (q.trim() ? searchFaqs(q, lang) : null), [q, lang]);
  return (
    <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="help-center">
      {/* 1.4.20 Ask VolleyLive (RAG phase 1) */}
      <Button title={t('ask.open')} icon="chatbubbles-outline" onPress={() => router.push('/ask')} testID="help-ask" />
      <View style={{ height: 12 }} />
      <Field label={t('help.search')} placeholder={t('help.searchHint')} value={q} onChangeText={setQ} testID="help-search" returnKeyType="search" maxLength={80} />
      {found ? (
        <>
          <Text style={[type.caption, { color: colors.muted, marginBottom: 8 }]} accessibilityLiveRegion="polite" testID="help-results">
            {found.length ? t('help.results', { count: found.length }) : t('help.noResults', { q: q.trim() })}
          </Text>
          {found.map((f) => <FaqItem key={f.id} f={f} lang={lang} />)}
        </>
      ) : (
        FAQ_CATEGORIES.map((c) => (
          <View key={c} style={{ marginBottom: 8 }} testID={`help-cat-${c}`} onLayout={(e) => scroller.category(c, e.nativeEvent.layout.y)}>
            <Text style={[type.caption, { color: colors.muted, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }]} accessibilityRole="header">{t(`help.cat.${c}`)}</Text>
            {FAQS.filter((f) => f.category === c).map((f) => <FaqItem key={f.id} f={f} lang={lang} focus={f.id === faqParam ? focusN : 0} onFocusLayout={(y) => scrollToFaq(c, y)} />)}
          </View>
        ))
      )}
      <Text style={[type.body, { fontWeight: '900', color: colors.text, marginTop: 12, marginBottom: 8 }]} accessibilityRole="header">{t('help.stillNeed')}</Text>
      <View style={{ gap: 8 }}>
        <Button title={t('help.contactUs')} icon="mail-outline" onPress={() => router.push('/contact')} testID="help-contact" />
        <Text
          onPress={() => void Linking.openURL(SUPPORT_URL)}
          accessibilityRole="button"
          accessibilityLabel={`${t('help.supportSite')}: ${SUPPORT_URL}`}
          style={[type.body, { color: colors.primaryText, fontWeight: '800', textDecorationLine: 'underline', paddingVertical: 10 }]}
          testID="help-support-url"
        >
          {t('help.supportSite')}: {SUPPORT_URL.replace(/^https:\/\//, '')}
        </Text>
        {contact.email ? <Button title={t('help.email')} icon="at-outline" variant="secondary" onPress={() => void Linking.openURL(mailtoUrl(contact.email!, 'VolleyLive'))} testID="help-email" /> : null}
        {contact.whatsapp ? <Button title={t('help.whatsapp')} icon="logo-whatsapp" variant="secondary" onPress={() => void Linking.openURL(whatsappUrl(contact.whatsapp!))} testID="help-whatsapp" /> : null}
      </View>
      {mine && mine.length ? (
        <View style={{ marginTop: 16 }} testID="help-my-tickets">
          <Text style={[type.body, { fontWeight: '900', color: colors.text, marginBottom: 8 }]} accessibilityRole="header">{t('help.myTickets')}</Text>
          {mine.map((x) => (
            <Card key={x.id} style={{ marginBottom: 8, padding: 12 }}>
              <Text style={[type.caption, { color: colors.muted }]}>{[t(`support.topics.${x.topic}`), t(`support.status.${x.status}`), formatWhenT(x.createdAt)].join(' · ')}</Text>
              <Text style={[type.body, { color: colors.text, marginTop: 4 }]} numberOfLines={3}>{x.message}</Text>
            </Card>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
