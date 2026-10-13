/**
 * 1.4.19 Profile > Help Center: searchable FAQs (EN / HI, core/helpFaq.ts), Contact us, my messages, and the support
 * email / WhatsApp links only when configured (services/supportContact.ts – no built-in contact details).
 */
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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

export function FaqItem({ f, lang }: { f: Faq; lang: 'en' | 'hi' }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ marginBottom: 8, padding: 12 }}>
      <PressableScale onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} testID={`faq-${f.id}`}>
        <Text style={[type.body, { fontWeight: '800', color: colors.text }]}>{f[lang].q}</Text>
      </PressableScale>
      {open ? <Text style={[type.body, { color: colors.text, marginTop: 6 }]} selectable testID={`faq-${f.id}-answer`}>{f[lang].a}</Text> : null}
    </Card>
  );
}

export default function HelpScreen() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'hi' = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<SupportTicket[] | null>(null);
  const contact = supportContact();
  useFocusEffect(useCallback(() => {
    backend.listMySupportTickets().then(setMine).catch(() => setMine([]));
  }, []));
  const found = useMemo(() => (q.trim() ? searchFaqs(q, lang) : null), [q, lang]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="help-center">
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
          <View key={c} style={{ marginBottom: 8 }} testID={`help-cat-${c}`}>
            <Text style={[type.caption, { color: colors.muted, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 }]} accessibilityRole="header">{t(`help.cat.${c}`)}</Text>
            {FAQS.filter((f) => f.category === c).map((f) => <FaqItem key={f.id} f={f} lang={lang} />)}
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
