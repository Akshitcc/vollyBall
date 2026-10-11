/**
 * Demo builds only (renders nothing elsewhere): "Demo admin" (QA E134-2) and "Simulate offline" (QA D133-1).
 * Launch prep: a separate module so production bundles replace it with DemoQaTools.prod.tsx (metro.config.js,
 * EXPO_PUBLIC_STRIP_DEMO=1) – the demo backend, seed data and these tools are not shipped at all.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch, Text, View } from 'react-native';
import { card } from './Hero';
import { DEMO_MODE } from '../services/config';
import { backend } from '../services/backend';
import { DemoBackend } from '../services/backend/demoBackend';
import { DEMO_QA_ADMIN } from '../services/backend/demoSeed';
import { connectivity, useOnline } from '../services/connectivity';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';

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
