import { Ionicons } from '@expo/vector-icons';
import { Tabs, useNavigation } from 'expo-router';
import { useRoute } from 'expo-router/react-navigation';
import React, { useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { inAppLinkPress, leakedTabParams } from '../../services/nav';
import { Platform, Text, useWindowDimensions, View, type ColorValue, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { PressableScale } from '../../components/PressableScale';
import { useTheme } from '../../theme/ThemeProvider';
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

/**
 * 1.4.22 tab bar (spec §3 "Tab bar": h88, 4 tabs + centre FAB). Day: white bar, 2px ink top border, the active icon
 * sits in a Ball pill with an ink border; FAB = orange circle, ink border + hard shadow. Night: near-black bar,
 * active label/icon Volt, FAB = Volt rounded diamond with glow.
 */
function TabIcon({ name, color, size, focused }: { name: keyof typeof Ionicons.glyphMap; color: ColorValue; size: number; focused: boolean }) {
  const { t, name: theme } = useTheme();
  if (theme === 'day' && focused)
    return (
      <View testID="tab-active-pill" style={{ backgroundColor: t.accent, borderWidth: 2, borderColor: t.outline, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 1 }}>
        <Ionicons name={name} color={t.text} size={size - 4} />
      </View>
    );
  return <Ionicons name={name} color={color as string} size={size} />;
}
const icon =
  (name: keyof typeof Ionicons.glyphMap) =>
  ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => <TabIcon name={name} color={color} size={size} focused={focused} />;

export function Fab({ size = 54 }: { size?: number }) {
  const { t, name } = useTheme();
  const day = name === 'day';
  return (
    <View testID="tab-fab" style={{ width: size, height: size, marginTop: -6, alignItems: 'center', justifyContent: 'center' }}>
      {day ? <View style={{ position: 'absolute', left: 3, top: 3, width: size, height: size, borderRadius: size / 2, backgroundColor: t.outline }} /> : null}
      <View style={[{ width: size, height: size, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
        day ? { borderRadius: size / 2, borderWidth: 2, borderColor: t.outline }
            : { borderRadius: 18, transform: [{ rotate: '45deg' }], shadowColor: t.primary, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } }]}>
        <Ionicons name="add" size={30} color={t.onPrimary} style={day ? undefined : { transform: [{ rotate: '-45deg' }] }} />
      </View>
    </View>
  );
}

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

type TabButtonProps = { href?: string; onPress?: (e: unknown) => void; style?: unknown; children?: React.ReactNode; web?: boolean } & Record<string, unknown>;
/** Tab bar button: press-scale feedback; on the web its link click stays inside the app (QA E134-1). */
export function TabButton({ href, onPress, style, children, web = Platform.OS === 'web', ...p }: TabButtonProps) {
  return (
    <PressableScale {...(p as object)} {...(href !== undefined ? { href } : {})} onPress={inAppLinkPress(onPress, { web, href })} scaleTo={0.92} style={style as never}>
      {children}
    </PressableScale>
  );
}

/**
 * 1.4.1 (QA V140-14): on the web every tab stays mounted, and an inactive tab was only aria-hidden – its
 * buttons were still in the Tab order (pressing Tab on Profile walked through the hidden Home screen first and
 * never seemed to reach Profile's header "Edit"). An inactive tab (or the tabs under a pushed screen) is now
 * `inert`: out of the Tab order and the accessibility tree, layout and scroll position untouched.
 */
export function TabScene({ navigation, children }: { navigation: { isFocused: () => boolean; addListener: (e: 'focus' | 'blur', cb: () => void) => () => void }; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const apply = () => {
      const el = ref.current as unknown as { inert?: boolean } | null;
      if (el) el.inert = !navigation.isFocused();
    };
    apply();
    const offFocus = navigation.addListener('focus', apply);
    const offBlur = navigation.addListener('blur', apply);
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View ref={ref} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const insets = useContext(SafeAreaInsetsContext) ?? { bottom: 0 }; // no provider in unit tests
  const { width } = useWindowDimensions();
  const m = tabBarMetrics(i18n.language ?? 'en', insets.bottom, width);
  const { t: tk, name: theme } = useTheme();
  const day = theme === 'day';
  const label = (key: string) => ({ color }: { color: ColorValue }) => <TabLabel text={t(key)} color={color} metrics={m} />;
  useStripLeakedParams();
  return (
    <Tabs
      screenLayout={({ navigation, children }) => <TabScene navigation={navigation}>{children}</TabScene>}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tk.tabActive,
        tabBarInactiveTintColor: tk.textMuted,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: { backgroundColor: day ? tk.surface : tk.bg, borderTopWidth: day ? 2 : 1, borderTopColor: day ? tk.outline : tk.surface2, height: m.height, paddingTop: m.paddingTop, paddingBottom: m.paddingBottom },
        tabBarItemStyle: { paddingHorizontal: 0 },
        // press feedback on every tab (scale, or an opacity dip with Reduce Motion)
        // On the web the button is a link: keep plain clicks in the app (no full page reload, which
        // lost the demo "Simulate offline" switch and every other in-memory state – QA E134-1).
        tabBarButton: ({ ref: _ref, ...p }) => <TabButton {...(p as TabButtonProps)} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarLabel: label('tabs.home'), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="map" options={{ title: t('tabs.map'), tabBarLabel: label('tabs.map'), tabBarIcon: icon('map') }} />
      <Tabs.Screen
        name="score"
        options={{
          title: t('tabs.score'), tabBarLabel: () => null, tabBarAccessibilityLabel: t('tabs.score'), // 1.4.22: the FAB has no caption (spec tab bar)
          tabBarIcon: () => <Fab />,
        }}
      />
      <Tabs.Screen name="tournaments" options={{ title: t('tabs.tournaments'), tabBarLabel: label('tabs.tournaments'), tabBarIcon: icon('trophy') }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarLabel: label('tabs.profile'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  );
}
