import { Platform } from 'react-native';

/**
 * 1.5.8 (Tester F157u-4): a focused star is picked with Space as well as Enter (web: react-native-web presses only
 * role=button on Space) and through the accessibility "activate" action (screen readers).
 */
export function starKeyProps(n: number, pick: (n: number) => void) {
  return {
    accessibilityActions: [{ name: 'activate' as const }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => { if (e.nativeEvent.actionName === 'activate') pick(n); },
    ...(Platform.OS === 'web'
      ? { onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
          if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') { e.preventDefault?.(); pick(n); }
        } }
      : {}),
  };
}
