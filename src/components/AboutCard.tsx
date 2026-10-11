/**
 * 1.3.4 Profile additions.
 *
 * - AboutCard (every build, sign-up hardening b): app version, which backend this build talks to
 *   (Demo / API / Firebase) and the API host. A demo build says plainly that sign-ups and matches stay
 *   on this phone – the reason phone sign-ups never reached MySQL.
 * - DemoQaTools (demo builds only, components/DemoQaTools.tsx – replaced by a stub in production bundles): "Demo admin" (approve flagged matches without real admin
 *   credentials) and "Simulate offline" (QA D133-1). Neither renders, nor works, outside DEMO_MODE.
 */
import Constants from 'expo-constants';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { card } from './Hero';
import { API_HOST, BACKEND_KIND, type BackendKind } from '../services/config';
import { colors } from '../theme';

const backendKey: Record<BackendKind, string> = { demo: 'about.backendDemo', api: 'about.backendApi', firebase: 'about.backendFirebase' };

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 }} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 14 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flexShrink: 1, textAlign: 'right' }} selectable>
        {value}
      </Text>
    </View>
  );
}

export function AboutCard({ kind = BACKEND_KIND, apiHost = API_HOST }: { kind?: BackendKind; apiHost?: string }) {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version ?? '';
  const code = Constants.expoConfig?.android?.versionCode;
  return (
    <View style={card} testID="about-card">
      {version ? <Line label={t('about.version')} value={code ? `${version} (${code})` : version} testID="about-version" /> : null}
      <Line label={t('about.backend')} value={t(backendKey[kind])} testID="about-backend" />
      {kind === 'api' ? <Line label={t('about.apiHost')} value={apiHost || '–'} testID="about-api-host" /> : null}
      {kind === 'demo' ? (
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 4 }} testID="about-demo-note">
          {t('about.demoNote')}
        </Text>
      ) : null}
    </View>
  );
}

// Launch prep: moved to its own module so production bundles (EXPO_PUBLIC_STRIP_DEMO=1) can swap it out.
export { DemoQaTools } from './DemoQaTools';
