/** 1.4.19 Help Center > Contact us: topic, message (10–2000 characters), optional gallery screenshot (core/support.ts). */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, Text, View } from 'react-native';
import { Button, Chip, Field } from '../components/ui';
import { checkSupportTicket, SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, SUPPORT_TOPICS, supportImageProblem, type SupportTopic } from '../core/support';
import { clampVisible, visibleLength } from '../core/text';
import { translateError } from '../i18n/format';
import { appVersionLabel } from '../services/appVersion';
import { backend } from '../services/backend';
import { pickPhoto } from '../services/camera';
import { showToast } from '../state/toast';
import { colors, type } from '../theme';

type Shot = { uri: string; type: string | null; size: number | null };

export default function ContactScreen() {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<SupportTopic | null>(null);
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 1.4.20 (QA V1419-5): the counter shows what the user sees (an emoji = 1); a longer paste is cut at the limit (the
  // code points the server stores, never splitting a character) and says so – no silent cut
  const [cut, setCut] = useState(false);
  const n = visibleLength(message.trim());
  const typeMessage = (raw: string) => {
    const r = clampVisible(raw, SUPPORT_MESSAGE_MAX);
    setCut(r.cut);
    setMessage(r.value);
  };
  const pick = async () => {
    setError(null);
    const p = await pickPhoto();
    if (!p) return;
    const s = { uri: p.uri, type: p.mimeType ?? null, size: p.fileSize ?? null };
    const bad = supportImageProblem(s.type, s.size);
    if (bad) return setError(translateError({ code: bad }, t));
    setShot(s);
  };
  const send = async () => {
    setError(null);
    try {
      checkSupportTicket({ topic: topic ?? '', message });
    } catch (e) {
      return setError(translateError(e, t));
    }
    setBusy(true);
    try {
      await backend.createSupportTicket({ topic: topic!, message, appVersion: appVersionLabel(), screenshot: shot });
      showToast(t('support.sent'));
      router.back();
    } catch (e) {
      setError(translateError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="contact-form">
      <Text style={[type.caption, { color: colors.muted, fontWeight: '900', marginBottom: 6 }]} accessibilityRole="header">{t('support.topic')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }} accessibilityRole="radiogroup">
        {SUPPORT_TOPICS.map((x) => <Chip key={x} label={t(`support.topics.${x}`)} active={topic === x} onPress={() => setTopic(x)} testID={`contact-topic-${x}`} />)}
      </View>
      <Field
        label={t('support.message')}
        placeholder={t('support.messageHint', { min: SUPPORT_MESSAGE_MIN, max: SUPPORT_MESSAGE_MAX })}
        value={message}
        onChangeText={typeMessage}
        maxLength={SUPPORT_MESSAGE_MAX * 8 + 8 /* UTF-16 units: well past 2000 visible characters (Hindi conjuncts, emoji), so typeMessage – not the browser – does the cut, by the counter's measure */}
        multiline
        style={{ minHeight: 120, textAlignVertical: 'top' }}
        testID="contact-message"
        hint={t('support.count', { n, max: SUPPORT_MESSAGE_MAX })}
      />
      {cut ? <Text style={[type.caption, { color: colors.primaryText, fontWeight: '700', marginTop: -6, marginBottom: 10 }]} accessibilityLiveRegion="polite" testID="contact-cut">{t('support.cut', { max: SUPPORT_MESSAGE_MAX })}</Text> : null}
      {shot ? (
        <View style={{ marginBottom: 12 }} testID="contact-shot">
          <Image source={{ uri: shot.uri }} style={{ width: 120, height: 200, borderRadius: 8, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
          <Button title={t('support.screenshotRemove')} variant="ghost" icon="close" onPress={() => setShot(null)} testID="contact-shot-remove" />
        </View>
      ) : (
        <View style={{ marginBottom: 12 }}>
          <Button title={t('support.screenshot')} variant="secondary" icon="image-outline" onPress={() => void pick()} testID="contact-pick" />
          <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]}>{t('support.screenshotHint')}</Text>
        </View>
      )}
      {error ? <Text style={[type.body, { color: colors.danger, marginBottom: 8, fontWeight: '700' }]} accessibilityRole="alert" testID="contact-error">{error}</Text> : null}
      <Text style={[type.caption, { color: colors.muted, marginBottom: 8 }]}>{t('support.versionNote', { v: appVersionLabel() })}</Text>
      <Button title={t('support.send')} icon="send" loading={busy} onPress={() => void send()} testID="contact-send" />
    </ScrollView>
  );
}
