/**
 * Sticky bottom bar that clears the Android navigation bar / iOS home indicator (1.3.2: Akshit's
 * phone showed the New match footer text under the nav bar). With edge-to-edge (RN 0.86 / SDK 57) the
 * app draws behind the system bars, so every bottom bar adds the safe-area bottom inset itself.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';
import { colors, elevation } from '../theme';

const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };
/** The safe-area insets (zero when no provider/mocked module is available, e.g. some unit tests). */
export function useInsets(): { top: number; bottom: number; left: number; right: number } {
  const hook = (SafeArea as { useSafeAreaInsets?: () => typeof ZERO }).useSafeAreaInsets;
  try {
    return (typeof hook === 'function' ? hook() : null) ?? ZERO;
  } catch {
    return ZERO; // outside a SafeAreaProvider
  }
}
/** Bottom padding for a bar at the screen edge: its own padding plus the system inset. */
export const bottomPadding = (insetBottom: number, base = 12) => base + Math.max(0, insetBottom);

export function SafeFooter({ children, style, testID = 'safe-footer' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const insets = useInsets();
  return (
    <View
      style={[{ backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPadding(insets.bottom), ...elevation.barTop }, style]}
      testID={testID}
    >
      {children}
    </View>
  );
}
