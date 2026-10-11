/**
 * 1.3.4 Profile additions.
 *
 * - AboutCard (every build, sign-up hardening b): app version, which backend this build talks to
 *   (Demo / API / Firebase) and the API host. A demo build says plainly that sign-ups and matches stay
 *   on this phone – the reason phone sign-ups never reached MySQL.
 * - DemoQaTools (demo builds only): "Demo admin" (approve flagged matches without real admin
 *   credentials) and "Simulate offline" (QA D133-1). Neither renders, nor works, outside DEMO_MODE.
 */
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';
import { card } from './Hero';
import { API_HOST, BACKEND_KIND, DEMO_MODE, type BackendKind } from '../services/config';
import { backend } from '../services/backend';
import { DemoBackend } from '../services/backend/demoBackend';
import { DEMO_QA_ADMIN } from '../services/backend/demoSeed';
import { connectivity, useOnline } from '../services/connectivity';
import { useAuth } from '../state/AuthContext';
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

function ToolRow({ label, hint, value, onChange, testID }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} testID={testID} accessibilityLabel={label} accessibilityHint={hint} />
    </View>
  );
}

/** Demo builds only (renders nothing elsewhere). */
export function DemoQaTools() {
  const { t } = useTranslation();
  const { user, isAdmin, refreshAdmin } = useAuth();
  const online = useOnline();
  const [simOffline, setSimOffline] = useState(connectivity.isSimulatedOffline());
  useEffect(() => connectivity.subscribe(() => setSimOffline(connectivity.isSimulatedOffline())), []);
  if (!DEMO_MODE || !(backend instanceof DemoBackend)) return null;
  const demo = backend;
  const uid = user?.uid ?? '';
  return (
    <View style={card} testID="demo-qa-tools">
      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{t('about.qaTools')}</Text>
      {/* 1.3.5 (QA E134-2): only the fixed demo admin account (+919000000001) sees this switch */}
      {demo.canBeDemoAdmin(uid) ? (
        <ToolRow
          label={t('about.demoAdmin')}
          hint={t('about.demoAdminHint')}
          value={isAdmin && demo.isDemoAdmin(uid)}
          testID="demo-admin-switch"
          onChange={async (v) => {
            await demo.setDemoAdmin(v);
            await refreshAdmin?.();
          }}
        />
      ) : (
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }} testID="demo-admin-who">
          {t('about.demoAdminWho', { phone: DEMO_QA_ADMIN.phone })}
        </Text>
      )}
      <ToolRow
        label={t('about.simulateOffline')}
        hint={online ? t('about.simulateOfflineHint') : t('about.simulateOfflineOn')}
        value={simOffline}
        testID="simulate-offline-switch"
        onChange={(v) => connectivity.setSimulatedOffline(v)}
      />
    </View>
  );
}
