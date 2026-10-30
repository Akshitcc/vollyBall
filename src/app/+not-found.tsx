/**
 * 1.5.8 (Tester F157x-4): an unknown route (a mistyped or old link) shows this screen instead of expo-router's default
 * (which listed a sitemap link). EN/HI, theme tokens (Day / Night), one way back: Home. No sitemap link.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button } from '../components/ui';
import { type } from '../theme';
import { useTheme } from '../theme/ThemeProvider';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  const { t: k } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: k.bg }} testID="not-found">
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <Ionicons name="compass-outline" size={56} color={k.textMuted} accessibilityElementsHidden importantForAccessibility="no" />
      <Text accessibilityRole="header" style={[type.h2, { color: k.text, marginTop: 12, textAlign: 'center' }]}>{t('notFound.title')}</Text>
      <Text style={[type.body, { color: k.textMuted, marginTop: 8, marginBottom: 20, textAlign: 'center', maxWidth: 360 }]}>{t('notFound.body')}</Text>
      <Button title={t('notFound.home')} icon="home" onPress={() => router.replace('/(tabs)')} testID="not-found-home" />
    </View>
  );
}
