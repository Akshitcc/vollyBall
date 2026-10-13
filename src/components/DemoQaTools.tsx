/**
 * Demo builds only (renders nothing elsewhere): "Demo admin" (QA E134-2) and "Simulate offline" (QA D133-1).
 * Launch prep: a separate module so production bundles replace it with DemoQaTools.prod.tsx (metro.config.js,
 * EXPO_PUBLIC_STRIP_DEMO=1) – the demo backend, seed data and these tools are not shipped at all.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Text, View } from 'react-native';
import { ToolRow } from './ToolRow';
import { card } from './Hero';
import { DEMO_MODE } from '../services/config';
import { backend } from '../services/backend';
import { DemoBackend } from '../services/backend/demoBackend';
import { DEMO_QA_ADMIN } from '../services/backend/demoSeed';
import { connectivity, useOnline } from '../services/connectivity';
import { useAuth } from '../state/AuthContext';
import { colors } from '../theme';

/** web: make a plain element a tap target for the browser's touch adjustment (QA V1416-5) without a Tab stop. */
export function tapTargetOnWeb(el: unknown): void {
  const n = el as { setAttribute?: (k: string, v: string) => void } | null;
  if (Platform.OS !== 'web' || !n?.setAttribute) return;
  n.setAttribute('tabindex', '-1');
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
      {/* 1.4.17 (QA V1416-5): a 10 px gap under the heading.
          1.4.18 (QA V1416-5 again): with touch input (DevTools touch emulation, phones) Chrome's touch adjustment moves
          a tap that lands on a non-target to the nearest tappable element inside the finger's area – a tap on the
          heading's bottom edge went to the Demo admin row 10 px below (elementFromPoint said H1). The heading is now a
          tap target itself on web (tabindex -1: mouse-focusable, not a Tab stop, no outline), so a tap on it stays on it. */}
      <Text
        ref={tapTargetOnWeb as never}
        style={[{ color: colors.text, fontWeight: '800', fontSize: 15, paddingBottom: 10 }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        accessibilityRole="header"
        testID="demo-qa-tools-heading"
      >
        {t('about.qaTools')}
      </Text>
      {/* 1.4.19 (QA V1418, V1416-5): the gap under the heading is the heading's own padding (a tap target that does
          nothing), not a margin, so Chrome's touch adjustment has no empty gap to move a tap from onto the switch row */}
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
