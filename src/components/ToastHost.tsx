import React from 'react';
import { Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hideToast, useToast } from '../state/toast';
import { colors } from '../theme';

/** Renders the app-wide toast (state/toast.ts) above every screen. Tap to dismiss. */
export function ToastHost() {
  const msg = useToast();
  const insets = useSafeAreaInsets();
  if (!msg) return null;
  return (
    <Pressable
      onPress={hideToast}
      testID="app-toast"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: insets.bottom + 72,
        alignItems: 'center',
      }}
    >
      <Text
        style={{
          backgroundColor: colors.toast,
          color: colors.white,
          fontWeight: '800',
          fontSize: 15,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 14,
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {msg}
      </Text>
    </Pressable>
  );
}
