/**
 * Push notifications via Expo push tokens (delivered through FCM on Android
 * and APNs on iOS). The Cloud Functions in /functions send pushes when a team
 * invite or challenge is created. Remote push does not work in Expo Go on
 * Android – use a development build.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import i18n from '../i18n';
import { backend } from './backend';

let configured = false;
function configure() {
  if (configured || Platform.OS === 'web') return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function registerForPush(uid: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return null;
    configure();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: i18n.t('notifications.channelName'),
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return null; // set EAS_PROJECT_ID to enable push
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await backend.savePushToken(uid, token);
    return token;
  } catch (e) {
    console.warn('Push registration skipped:', e);
    return null;
  }
}

/** Open the right screen when the user taps a push notification. */
export function useNotificationRouting(navigate: (path: string) => void) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as Record<string, string> | undefined;
      if (!d) return;
      if (d.type === 'match' && d.matchId) navigate(`/match/${d.matchId}`);
      else if (d.type === 'teamInvite') navigate('/'); // invites are accepted on Home
      else if (d.type === 'challenge' && d.matchId) navigate(`/match/${d.matchId}`);
      else navigate('/');
    });
    return () => sub.remove();
  }, [navigate]);
}
