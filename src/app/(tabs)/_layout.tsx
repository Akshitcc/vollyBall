import { Ionicons } from '@expo/vector-icons';
import { Tabs, useNavigation } from 'expo-router';
import { useRoute } from 'expo-router/react-navigation';
import React, { useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { leakedTabParams } from '../../services/nav';
import { Platform, Text, useWindowDimensions, type ColorValue, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { PressableScale } from '../../components/PressableScale';
import { colors } from '../../theme';
import { tabBarMetrics } from '../../theme/tabBar';

/** Web: wrap only between words (two-word Hindi labels), never inside one. */
const KEEP_WORDS = (Platform.OS === 'web' ? { wordBreak: 'keep-all', overflowWrap: 'normal' } : {}) as TextStyle;

function TabLabel({ text, color, metrics }: { text: string; color: ColorValue; metrics: ReturnType<typeof tabBarMetrics> }) {
  return (
    <Text
      numberOfLines={2}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={[{ color, fontWeight: '800', fontSize: metrics.fontSize, lineHeight: metrics.lineHeight, textAlign: 'center', marginTop: 2 }, KEEP_WORDS]}
    >
      {text}
    </Text>
  );
}

const icon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size }: { color: import('react-native').ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

/**
 * Fix re-test 209: a deep link (/team/team_smashers) puts the tabs underneath with the link's own
 * params (expo-router copies them onto the initial route), so the header back link's href read
 * "/?id=team_smashers" even though landing there was clean. The tabs are mounted under the
 * deep-linked screen, so the stray params are cleared right away, not only when (tabs) gets focus.
 */
function useStripLeakedParams() {
  const navigation = useNavigation();
  const route = useRoute();
  useEffect(() => {
    const leak = leakedTabParams(route.params as object | undefined);
    if (!leak) return;
    // Deferred one tick: a setParams dispatched while the navigators are still mounting for the
    // first time is dropped (seen in the browser: the href kept the ?id=).
    const timer = setTimeout(() => navigation.setParams(leak as never), 0);
    return () => clearTimeout(timer);
  }, [navigation, route.params]);
}

export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const insets = useContext(SafeAreaInsetsContext) ?? { bottom: 0 }; // no provider in unit tests
  const { width } = useWindowDimensions();
  const m = tabBarMetrics(i18n.language ?? 'en', insets.bottom, width);
  const label = (key: string) => ({ color }: { color: ColorValue }) => <TabLabel text={t(key)} color={color} metrics={m} />;
  useStripLeakedParams();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: { backgroundColor: colors.ink, borderTopWidth: 2, borderTopColor: colors.primary, height: m.height, paddingTop: m.paddingTop, paddingBottom: m.paddingBottom },
        tabBarItemStyle: { paddingHorizontal: 0 },
        // press feedback on every tab (scale, or an opacity dip with Reduce Motion)
        tabBarButton: ({ ref: _ref, style, children, ...p }) => (
          <PressableScale {...(p as object)} scaleTo={0.92} style={style as never}>
            {children}
          </PressableScale>
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarLabel: label('tabs.home'), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="map" options={{ title: t('tabs.map'), tabBarLabel: label('tabs.map'), tabBarIcon: icon('map') }} />
      <Tabs.Screen
        name="score"
        options={{
          title: t('tabs.score'), tabBarLabel: label('tabs.score'),
          tabBarIcon: ({ size }) => <Ionicons name="add-circle" color={colors.primary} size={size + 10} />,
        }}
      />
      <Tabs.Screen name="tournaments" options={{ title: t('tabs.tournaments'), tabBarLabel: label('tabs.tournaments'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarLabel: label('tabs.profile'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
