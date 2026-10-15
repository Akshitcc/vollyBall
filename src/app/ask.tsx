/**
 * 1.4.20 Help Center > Ask VolleyLive (RAG phase 1): a simple chat. Each answer is grounded in the Help Center FAQs or
 * our own volleyball rule notes, and lists its sources (FAQ → opens it in the Help Center; rules → the official FIVB
 * page). With nothing to go on it says "I don't know" and offers Contact us. Questions are not stored on the device.
 */
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Button, Card, Field } from '../components/ui';
import { ASK_QUESTION_MAX, ASK_QUESTION_MIN, type AskAnswer, type AskSource } from '../core/ask';
import { clampCodePoints } from '../core/text';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { colors, type } from '../theme';

type Turn = { id: number; q: string; a: AskAnswer | null; error: string | null };

/** 1.4.21 (QA V1420-6): an in-app FAQ link (also a rule note mapped to an FAQ) opens the Help Center; only a rule-only
 * source opens the official FIVB page. */
export const faqIdOf = (url: string): string | null => {
  const m = /^volleylive:\/\/help\?faq=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};
/** 1.4.22 (QA V1421-10): app-only answers (FAQ sources, or rule notes mapped to an in-app FAQ) carry no FIVB note. */
export const needsFivbNote = (sources: readonly AskSource[]) => sources.some((s) => s.kind === 'rules' && !faqIdOf(s.url));
export function openAskSource(s: AskSource) {
  const faq = faqIdOf(s.url);
  if (faq) return router.push({ pathname: '/help', params: { faq } });
  if (/^https:\/\//.test(s.url)) void Linking.openURL(s.url);
}

export default function AskScreen() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'hi' = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const send = async () => {
    const question = q.replace(/\s+/g, ' ').trim();
    if ([...question].length < ASK_QUESTION_MIN || busy) return;
    const id = ++seq.current;
    setTurns((l) => [...l, { id, q: question, a: null, error: null }]);
    setQ('');
    setBusy(true);
    try {
      const a = await backend.askVolleyLive(question, lang);
      setTurns((l) => l.map((x) => (x.id === id ? { ...x, a } : x)));
    } catch (e) {
      setTurns((l) => l.map((x) => (x.id === id ? { ...x, error: translateError(e, t) } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd?.({ animated: true }), 50);
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="ask-screen">
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={[type.body, { color: colors.muted, marginBottom: 12 }]} testID="ask-intro">{t('ask.intro')}</Text>
        {turns.map((x) => (
          <View key={x.id} style={{ marginBottom: 12 }} testID={`ask-turn-${x.id}`}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.primary, borderRadius: 12, padding: 10, marginBottom: 6 }}>
              <Text style={[type.body, { color: colors.onPrimary }]} selectable>{x.q}</Text>
            </View>
            <Card style={{ padding: 12, maxWidth: '95%' }}>
              {x.error ? (
                <Text style={[type.body, { color: colors.danger }]} accessibilityRole="alert" testID={`ask-error-${x.id}`}>{x.error}</Text>
              ) : !x.a ? (
                <Text style={[type.body, { color: colors.muted }]} accessibilityLiveRegion="polite">{t('ask.thinking')}</Text>
              ) : x.a.idk ? (
                <View testID={`ask-idk-${x.id}`}>
                  <Text style={[type.body, { color: colors.text }]} accessibilityLiveRegion="polite">{t('ask.idk')}</Text>
                  <Button title={t('help.contactUs')} icon="mail-outline" variant="secondary" onPress={() => router.push('/contact')} testID={`ask-contact-${x.id}`} />
                </View>
              ) : (
                <View testID={`ask-answer-${x.id}`}>
                  <Text style={[type.body, { color: colors.text }]} selectable accessibilityLiveRegion="polite">{x.a.answer}</Text>
                  <Text style={[type.caption, { color: colors.muted, fontWeight: '900', marginTop: 8 }]}>{t('ask.sources')}</Text>
                  {x.a.sources.map((s, i) => (
                    <Text key={s.id} onPress={() => openAskSource(s)} accessibilityRole="button" style={[type.caption, { color: colors.primaryText, fontWeight: '800', textDecorationLine: 'underline', paddingVertical: 6 }]} testID={`ask-source-${x.id}-${i}`}>
                      {i + 1}. {s.kind === 'rules' && !faqIdOf(s.url) ? t('ask.rulesSource', { title: s.title }) : s.title}
                    </Text>
                  ))}
                  {/* 1.4.22 (QA V1421-10): the FIVB note only when a rule summary that links to FIVB is among the sources */}
                  {needsFivbNote(x.a.sources) ? <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]} testID={`ask-disclaimer-${x.id}`}>{t('ask.disclaimer')}</Text> : null}
                </View>
              )}
            </Card>
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.bg }}>
        <Field
          label={t('ask.label')}
          placeholder={t('ask.placeholder')}
          value={q}
          onChangeText={(v) => setQ(clampCodePoints(v, ASK_QUESTION_MAX).value)}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          blurOnSubmit={false}
          maxLength={ASK_QUESTION_MAX * 2}
          testID="ask-input"
        />
        <Button title={t('ask.send')} icon="send" loading={busy} disabled={[...q.trim()].length < ASK_QUESTION_MIN} onPress={() => void send()} testID="ask-send" />
      </View>
    </View>
  );
}
