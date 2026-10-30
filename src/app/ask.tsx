/**
 * 1.4.20 Help Center > Ask VolleyLive; 1.5.0 the chat: history saved per user (Clear chat), suggested questions, answers
 * grounded in the Help Center, our rule notes and the how-to guides (sources listed), read-only look-ups of your stats,
 * teams, matches, live scores, tournaments, challenges and the leaderboard shown as cards. "I don't know" offers
 * Contact us. Day/Night via useTheme().t, EN/HI via i18n.
 */
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Field } from '../components/ui';
import { Body, Sticker, useKit } from '../components/DNKit';
import { AskCards } from '../components/ask/AskCards';
import { ASK_QUESTION_MAX, ASK_QUESTION_MIN, localSourceTitle, type AskSource } from '../core/ask';
import type { AskHistoryItem } from '../core/ask/agent';
import { clampCodePoints } from '../core/text';
import { maskPiiStored } from '../core/pii';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { confirmAsk } from '../services/dialogs';

type Turn = { key: string; q: string; a: AskHistoryItem | null; error: string | null };

/** 1.4.21 (QA V1420-6): an in-app FAQ link (also a rule note mapped to an FAQ) opens the Help Center; only a rule-only
 * source opens the official FIVB page. */
export const faqIdOf = (url: string): string | null => {
  const m = /^volleylive:\/\/help\?faq=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
};
/** 1.5.0: a how-to guide links to its screen (volleylive://open?path=/teams). Only app paths are opened. */
export const screenPathOf = (url: string): string | null => {
  const m = /^volleylive:\/\/open\?path=([^&]+)/.exec(url);
  const p = m ? decodeURIComponent(m[1]) : null;
  return p && /^\/[A-Za-z0-9/_()-]*$/.test(p) ? p : null;
};
/** 1.4.22 (QA V1421-10): app-only answers (FAQ sources, or rule notes mapped to an in-app FAQ) carry no FIVB note. */
export const needsFivbNote = (sources: readonly AskSource[]) => sources.some((s) => s.kind === 'rules' && !faqIdOf(s.url));
export function openAskSource(s: AskSource) {
  const faq = faqIdOf(s.url);
  if (faq) return router.push({ pathname: '/help', params: { faq } });
  const path = screenPathOf(s.url);
  if (path) return router.push(path as never);
  if (/^https:\/\//.test(s.url)) void Linking.openURL(s.url);
}
export const SUGGESTIONS = ['stats', 'next', 'live', 'teams', 'leaderboard', 'rules'] as const;

export default function AskScreen() {
  const { t: tr, i18n } = useTranslation();
  const { t, f, day } = useKit();
  const lang: 'en' | 'hi' = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const seq = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const toEnd = () => setTimeout(() => scroll.current?.scrollToEnd?.({ animated: true }), 50);

  useEffect(() => {
    let live = true;
    backend.askHistory().then((items) => {
      if (!live) return;
      setTurns((cur) => [...items.map((a) => ({ key: `h${a.id}`, q: a.question, a, error: null })), ...cur]);
      toEnd();
    }).catch(() => live && setHistoryError(true));
    return () => { live = false; };
  }, []);

  const send = async (text?: string) => {
    const question = (text ?? q).replace(/\s+/g, ' ').trim();
    if ([...question].length < ASK_QUESTION_MIN || busy) return;
    const key = `n${++seq.current}`;
    // 1.5.3 (Tester F152-5): the optimistic bubble never shows a typed phone / e-mail (same mask as the stored copy) …
    setTurns((l) => [...l, { key, q: maskPiiStored(question), a: null, error: null }]);
    if (!text) setQ('');
    setBusy(true);
    try {
      const a = await backend.askChat(question, lang);
      // … and is replaced by the question the host stored (server / demo / on-device: masked) when the answer arrives
      setTurns((l) => l.map((x) => (x.key === key ? { ...x, q: a.question || x.q, a } : x)));
    } catch (e) {
      setTurns((l) => l.map((x) => (x.key === key ? { ...x, error: translateError(e, tr) } : x)));
    } finally {
      setBusy(false);
      toEnd();
    }
  };
  const clear = async () => {
    if (!(await confirmAsk(tr('ask.clearBody'), { title: tr('ask.clearTitle'), confirmLabel: tr('ask.clear'), cancelLabel: tr('ask.clearCancel'), destructive: true }))) return;
    try { await backend.clearAskHistory(); setTurns([]); } catch (e) { setTurns((l) => [...l, { key: `e${++seq.current}`, q: '', a: null, error: translateError(e, tr) }]); }
  };
  // 1.5.8 (Tester F157u-3): the title in the UI language (core localSourceTitle), not the retrieved chunk's language
  const sourceLabel = (s: AskSource) => {
    const title = localSourceTitle(s, lang);
    return s.kind === 'rules' && !faqIdOf(s.url) ? tr('ask.rulesSource', { title }) : s.kind === 'guide' ? tr('ask.guideSource', { title }) : title;
  };

  const chips = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingVertical: 4 }} testID="ask-suggestions" accessibilityLabel={tr('ask.suggestionsTitle')}>
      {SUGGESTIONS.map((k) => (
        <Pressable key={k} onPress={() => void send(tr(`ask.suggestions.${k}`))} disabled={busy} accessibilityRole="button" testID={`ask-suggest-${k}`}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.radius.chip, backgroundColor: day ? t.surface : t.surface2, borderWidth: day ? 2 : 1, borderColor: day ? t.outline : t.surface2, minHeight: 36, justifyContent: 'center' }}>
          <Text style={[{ color: t.text, fontSize: 13 }, f.bold]} numberOfLines={1}>{tr(`ask.suggestions.${k}`)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} testID="ask-screen">
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
          <Text style={{ flex: 1, color: t.textMuted, fontSize: 14, lineHeight: 20 }} testID="ask-intro">{tr('ask.intro2')}</Text>
          {turns.length ? (
            <Pressable onPress={() => void clear()} accessibilityRole="button" testID="ask-clear" style={{ paddingHorizontal: 10, paddingVertical: 6, minHeight: 36, justifyContent: 'center' }}>
              <Text style={[{ color: t.text, fontSize: 13, textDecorationLine: 'underline' }, f.bold]}>{tr('ask.clear')}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: day ? t.surface : t.surface2, borderWidth: day ? 2 : 0, borderColor: t.outline, marginBottom: 12 }} testID="ask-readonly">
          <Text style={[{ color: t.text, fontSize: 12 }, f.bold]}>🔒 {tr('ask.readOnly')}</Text>
        </View>
        {historyError ? <Body muted size={12} testID="ask-history-error">{tr('ask.historyError')}</Body> : null}
        {!turns.length ? (
          <View style={{ marginBottom: 8 }}>
            <Body bold size={13} style={{ marginBottom: 4 }}>{tr('ask.suggestionsTitle')}</Body>
            {chips}
          </View>
        ) : null}
        {turns.map((x) => (
          <View key={x.key} style={{ marginBottom: 14 }} testID={`ask-turn-${x.key}`}>
            {x.q ? (
              <View style={{ alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: t.primary, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 }} accessibilityLabel={`${tr('ask.you')}: ${x.q}`}>
                <Text style={{ color: t.onPrimary, fontSize: 14 }} selectable>{x.q}</Text>
              </View>
            ) : null}
            {x.error ? (
              <Text style={{ color: t.liveText, fontSize: 14 }} accessibilityRole="alert" testID={`ask-error-${x.key}`}>{x.error}</Text>
            ) : !x.a ? (
              <Text style={{ color: t.textMuted, fontSize: 14 }} accessibilityLiveRegion="polite">{tr('ask.thinking')}</Text>
            ) : x.a.idk ? (
              <Sticker testID={`ask-idk-${x.key}`} inner={{ padding: 12 }}>
                <Text style={{ color: t.text, fontSize: 14, lineHeight: 20 }} accessibilityLiveRegion="polite">{tr('ask.idk')}</Text>
                <Button title={tr('help.contactUs')} icon="mail-outline" variant="secondary" onPress={() => router.push('/contact')} testID={`ask-contact-${x.key}`} style={{ marginTop: 8 }} />
              </Sticker>
            ) : (
              <View testID={`ask-answer-${x.key}`}>
                <Sticker inner={{ padding: 12 }}>
                  {x.a.refusal === 'private' ? <Body bold size={12} style={{ marginBottom: 4 }}>🔒 {tr('ask.refusedPrivate')}</Body> : null}
                  <Text style={{ color: t.text, fontSize: 14, lineHeight: 20 }} selectable accessibilityLiveRegion="polite" testID={`ask-text-${x.key}`}>{x.a.answer}</Text>
                  {x.a.sources.length ? (
                    <>
                      <Text style={[{ color: t.textMuted, fontSize: 12, marginTop: 8 }, f.bold]}>{tr('ask.sources')}</Text>
                      {x.a.sources.map((s, i) => (
                        <Text key={s.id} onPress={() => openAskSource(s)} accessibilityRole="button" style={[{ color: t.text, fontSize: 13, textDecorationLine: 'underline', paddingVertical: 6 }, f.bold]} testID={`ask-source-${x.key}-${i}`}>
                          {i + 1}. {sourceLabel(s)}
                        </Text>
                      ))}
                    </>
                  ) : null}
                  {needsFivbNote(x.a.sources) ? <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 4 }} testID={`ask-disclaimer-${x.key}`}>{tr('ask.disclaimer')}</Text> : null}
                </Sticker>
                <AskCards cards={x.a.cards ?? []} testID={`ask-cards-${x.key}`} />
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 12, borderTopWidth: day ? 2 : 1, borderColor: day ? t.outline : t.surface2, backgroundColor: t.bg }}>
        {turns.length ? chips : null}
        <Field
          label={tr('ask.label')}
          placeholder={tr('ask.placeholder')}
          value={q}
          onChangeText={(v) => setQ(clampCodePoints(v, ASK_QUESTION_MAX).value)}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          blurOnSubmit={false}
          maxLength={ASK_QUESTION_MAX * 2}
          testID="ask-input"
        />
        <Button title={tr('ask.send')} icon="send" loading={busy} disabled={[...q.trim()].length < ASK_QUESTION_MIN} onPress={() => void send()} testID="ask-send" />
      </View>
    </View>
  );
}
