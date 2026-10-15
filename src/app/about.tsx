/**
 * 1.3.7 Profile > About VolleyLive: name, logo, version/build (expo-constants), what the app does,
 * T&C and the DRAFT privacy policy, Send feedback / Rate VolleyLive, open-source licenses (generated
 * from node_modules by scripts/gen-licenses.js – not hand-written; 1.3.8: the full transitive list with
 * licence texts opens on its own screen, /licenses), "Made in India", and a small Technical info section.
 * 1.3.8 (V137-12): web shows "Version x" only; native adds the store build number.
 */
import { Ionicons } from '@expo/vector-icons';
import { appVersionInfo } from '../services/appVersion';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { AboutCard } from '../components/AboutCard';
import { SectionHeader, card } from '../components/Hero';
import { Button } from '../components/ui';
import licenses from '../generated/licenses.json';
import type { LicenseData } from '../core/licenses';
import { openStoreListing } from '../services/review';
import { colors, type } from '../theme';

export const ABOUT_FEATURES = ['score', 'teams', 'rankings', 'tournaments', 'courts', 'photos', 'offline', 'languages'] as const;

function Link({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 10 }}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={[type.body, { color: colors.text, flex: 1, fontWeight: '600' }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

export default function AboutScreen() {
  const { t } = useTranslation();
  const { version, build } = appVersionInfo();
  const count = (licenses as LicenseData).packages.length;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="about-screen">
      <View style={{ alignItems: 'center', marginBottom: 8 }}>
        <Image source={require('../../assets/icon.png')} style={{ width: 88, height: 88, borderRadius: 20 }} accessibilityIgnoresInvertColors accessible accessibilityLabel={t('aboutPage.logo')} testID="about-logo" />
        <Text style={[type.h1, { color: colors.text, marginTop: 10 }]} accessibilityRole="header">VolleyLive</Text>
        <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} testID="about-page-version">
          {build ? t('aboutPage.versionLine', { version, build }) : t('aboutPage.versionOnly', { version })}
        </Text>
      </View>
      <View style={card}>
        <Text style={[type.body, { color: colors.text }]} testID="about-description">{t('aboutPage.description')}</Text>
        <View style={{ marginTop: 10, gap: 6 }}>
          {ABOUT_FEATURES.map((k) => (
            <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
              <Ionicons name="checkmark-circle" size={18} color={colors.successStrong} />
              <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t(`aboutPage.features.${k}`)}</Text>
            </View>
          ))}
        </View>
      </View>

      <SectionHeader title={t('aboutPage.legal')} />
      <View style={card}>
        <Link icon="document-text-outline" label={t('aboutPage.terms')} onPress={() => router.push('/terms-view')} testID="about-terms" />
        <Link icon="shield-checkmark-outline" label={t('aboutPage.privacy')} onPress={() => router.push('/privacy')} testID="about-privacy" />
        <Link icon="code-slash-outline" label={t('aboutPage.licenses', { count })} onPress={() => router.push('/licenses')} testID="about-licenses" />
      </View>

      <SectionHeader title={t('aboutPage.support')} />
      <View style={{ gap: 8 }}>
        <Button title={t('feedback.open')} icon="chatbox-ellipses-outline" variant="secondary" onPress={() => router.push('/feedback')} testID="about-feedback" />
        <Button title={t('review.rate')} icon="star-outline" variant="secondary" onPress={() => void openStoreListing()} testID="about-rate" />
        <Text style={[type.caption, { color: colors.muted }]}>{t('review.notLive')}</Text>
      </View>

      <Text style={[type.body, { color: colors.text, textAlign: 'center', marginTop: 20, fontWeight: '700' }]} testID="about-made-in-india">
        {t('aboutPage.madeInIndia')}
      </Text>

      <SectionHeader title={t('aboutPage.technical')} />
      <AboutCard />
    </ScrollView>
  );
}
