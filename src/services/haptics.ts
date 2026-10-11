/** Haptics (design-spec §6): no-ops on web and never throws. */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'point' | 'undo' | 'select' | 'warning' | 'success' | 'error' | 'heavy';

export function haptic(kind: HapticKind) {
  if (Platform.OS === 'web') return;
  const run = (): Promise<void> | undefined => {
    switch (kind) {
      case 'point':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'undo':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'heavy':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      case 'select':
        return Haptics.selectionAsync?.();
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };
  try {
    void run()?.catch?.(() => {});
  } catch {
    // haptics unavailable
  }
}
