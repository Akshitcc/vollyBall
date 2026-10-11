/** 1.3.7 Profile > Send feedback: 1–5 stars + optional text. Admins read it; it is never rewarded. */
import { Ionicons } from '@expo/vector-icons';
import { appVersionLabel } from '../services/appVersion';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { PressableScale } from '../components/PressableScale';
import { Button, styles as ui } from '../components/ui';
import { checkFeedback, FEEDBACK_MAX } from '../core/reviewPrompt';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { showToast } from '../state/toast';
import { colors, type } from '../theme';

export { appVersionLabel }; // (moved to services/appVersion.ts in 1.3.8)

export default function FeedbackScreen() {
  const { t } = useTranslation();
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const over = [...text].length > FEEDBACK_MAX;
  const send = async () => {
    setError(null);
    try {
      checkFeedback({ stars, text });
    } catch (e) {
      setError(translateError(e, t));
      return;
    }
    setBusy(true);
    try {
      await backend.sendFeedback({ stars, text, appVersion: appVersionLabel() });
      showToast(t('feedback.thanks'));
      router.back();
    } catch (e) {
      setError(translateError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="feedback-screen">
      <Text style={[type.body, { color: colors.text }]}>{t('feedback.intro')}</Text>
      <Text style={[ui.label, { marginTop: 16 }]}>{t('feedback.starsLabel')}</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <PressableScale
            key={n}
            onPress={() => setStars(n)}
            accessibilityRole="radio"
            accessibilityState={{ checked: stars === n }}
            accessibilityLabel={t('feedback.starN', { count: n })}
            testID={`feedback-star-${n}`}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={32} color={n <= stars ? '#F5A623' : colors.muted} />
          </PressableScale>
        ))}
      </View>
      <Text style={[ui.label, { marginTop: 16 }]}>{t('feedback.textLabel')}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={FEEDBACK_MAX}
        placeholder={t('feedback.textPlaceholder')}
        placeholderTextColor={colors.placeholder}
        style={[ui.input, { minHeight: 120, textAlignVertical: 'top' }, over && { borderColor: colors.danger }]}
        accessibilityLabel={t('feedback.textLabel')}
        aria-invalid={over}
        testID="feedback-text"
      />
      <Text style={[type.caption, { color: over ? colors.danger : colors.muted, marginTop: 4, textAlign: 'right' }]} testID="feedback-count">
        {[...text].length}/{FEEDBACK_MAX}
      </Text>
      <Text style={[type.caption, { color: colors.muted, marginTop: 8 }]}>{t('feedback.noRewards')}</Text>
      {error ? (
        <Text style={[type.body, { color: colors.danger, marginTop: 10 }]} accessibilityRole="alert" testID="feedback-error">
          {error}
        </Text>
      ) : null}
      <Button title={t('feedback.send')} icon="send" onPress={() => void send()} loading={busy} style={{ marginTop: 16 }} testID="feedback-send" />
    </ScrollView>
  );
}
