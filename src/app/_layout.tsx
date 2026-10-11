import { profileComplete } from '../core/registration';
import { BACKEND_KIND, MIN_AGE } from '../services/config';
import { router, Stack } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import type { NativeStackHeaderBackProps } from 'expo-router/build/react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogHost } from '../components/DialogHost';
import { ToastHost } from '../components/ToastHost';
import { Loading } from '../components/ui';
import '../i18n';
import { LanguageGate } from '../i18n/LanguageGate';
import { backFallback, goBackOr, leakedTabParams, NO_BACK_ROUTES } from '../services/nav';
import { useNotificationRouting } from '../services/notifications';
import { AuthProvider, useAuth } from '../state/AuthContext';
import { colors } from '../theme';

const navigate = (path: string) => router.push(path as never);

// A screen opened directly (fresh tab, shared link, notification) gets the tabs underneath it,
// so it has a back arrow and leaving it shows the tab bar again (fix re-test #1).
// Detail screens (team, match, tournament, court, forms) are root-stack screens shown *over* the
// tabs, on web and native alike, whether pushed in-app or deep-linked: neither shows the tab bar,
// both have a back arrow, and back lands on a clean route. Moving them into per-tab nested stacks
// would change every URL (e.g. /profile/team/…), need shared copies under several tabs and break
// existing links and notification routes, so deep links are made to match in-app pushes instead.
export const unstable_settings = { initialRouteName: '(tabs)' };

/**
 * expo-router (like React Navigation) gives that injected (tabs) route the deep link's own params,
 * so going back from /team/team_smashers showed "/?id=team_smashers". The tabs never take params of
 * their own, so whenever (tabs) gets focus any such params are cleared and the URL stays clean.
 * Same on native, where the stray params were invisible but still in the navigation state.
 */
const stripLeakedTabParams = ({ navigation, route }: { navigation: { setParams: (p: object) => void }; route: { params?: object } }) => {
  const clean = () => {
    const leak = leakedTabParams(route.params);
    if (leak) navigation.setParams(leak);
  };
  return { focus: clean, state: clean };
};

function RootStack() {
  const { user, profile, loading, termsOk } = useAuth();
  const { t } = useTranslation();
  useNotificationRouting(navigate);
  // 1.3.6: profiles from before the registration fields must be completed first (after the T&C gate).
  const ready = !!profile && (BACKEND_KIND === 'firebase' || profileComplete(profile, MIN_AGE));
  if (loading) return <Loading />;
  return (
    <Stack
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.ink },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: colors.bg },
        // The default back button is labelled "<previous title>, back" ("(tabs), back",
        // "Smashers, back") in English even in Hindi (QA bug J). Use one translated label instead.
        // On web the arrow is always shown (except on tab roots, sign-in and first-time profile) and
        // falls back to the screen's natural tab when there is no history (services/nav.ts).
        ...(Platform.OS === 'web' && !NO_BACK_ROUTES.has(route.name)
          ? {
              headerLeft: (p: NativeStackHeaderBackProps & { canGoBack?: boolean; onPress?: () => void }) => (
                <HeaderBackButton
                  {...p}
                  onPress={() => goBackOr(backFallback(route.name, route.params))}
                  tintColor={colors.white}
                  accessibilityLabel={t('common.goBack')}
                  testID="header-back"
                />
              ),
            }
          : null),
      })}
    >
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      {/* 1.3.0: the T&C gate comes before registration, and again after a T&C version change. */}
      <Stack.Protected guard={!!user && !termsOk}>
        <Stack.Screen name="terms" options={{ title: t('terms.title'), headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user && termsOk && !ready}>
        <Stack.Screen name="setup-profile" options={{ title: t('titles.setupProfile'), headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user && termsOk && ready}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'VolleyLive' }} listeners={stripLeakedTabParams} />
        <Stack.Screen name="edit-profile" options={{ title: t('titles.editProfile') }} />
        <Stack.Screen name="team/new" options={{ title: t('titles.newTeam') }} />
        <Stack.Screen name="team/[id]" options={{ title: t('titles.team') }} />
        <Stack.Screen name="match/new" options={{ title: t('titles.newMatch') }} />
        <Stack.Screen name="match/[id]/index" options={{ title: t('titles.match') }} />
        <Stack.Screen name="match/[id]/score" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="challenge/new" options={{ title: t('titles.challenge') }} />
        <Stack.Screen name="tournament/new" options={{ title: t('titles.newTournament') }} />
        <Stack.Screen name="tournament/[id]" options={{ title: t('titles.tournament') }} />
        <Stack.Screen name="court/new" options={{ title: t('titles.newCourt') }} />
        <Stack.Screen name="court/[id]" options={{ title: t('titles.court') }} />
        <Stack.Screen name="rankings" options={{ title: t('titles.rankings') }} />
        <Stack.Screen name="teams" options={{ title: t('teamsScreen.title') }} />
        <Stack.Screen name="memories" options={{ title: t('memoriesScreen.title') }} />
        <Stack.Screen name="wallet" options={{ title: t('wallet.title') }} />
        <Stack.Screen name="admin-review" options={{ title: t('verify.adminTitle') }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LanguageGate fallback={<Loading />}>
        <AuthProvider>
          <StatusBar style="light" />
          <View style={{ flex: 1 }}>
            <RootStack />
            <ToastHost />
            <DialogHost />
          </View>
        </AuthProvider>
      </LanguageGate>
    </SafeAreaProvider>
  );
}
