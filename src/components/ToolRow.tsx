/** A testing-tool switch row (DemoQaTools); its own module so it can be tested without the demo backend. */
import React from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { colors } from '../theme';

// 1.4.14 (QA V1413-7): the whole row (label + hint) flips the switch, and is ONE accessible switch (role, label, hint, checked)
// 1.4.15 (QA V1414-1, web): react-native-web renders neither accessibilityState nor accessibilityHint, and Space only
// presses role=button – so the row also sets aria-checked, points aria-describedby at the hint, and toggles on Space
/** The web-only switch attributes react-native-web doesn't derive itself (QA V1414-1). */
export function webSwitchProps(value: boolean, hintId: string, onChange: (v: boolean) => void) {
  return {
    'aria-checked': value,
    'aria-describedby': hintId,
    onKeyDown: (e: { key?: string; preventDefault?: () => void }) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault?.();
        onChange(!value);
      }
    },
  };
}
/** web: the Switch's ref is its <input> – take it out of the tab order and the accessibility tree (QA V1415-2). */
export function hideFromWeb(el: unknown): void {
  const n = el as { tabIndex?: number; setAttribute?: (k: string, v: string) => void } | null;
  if (Platform.OS !== 'web' || !n || !n.setAttribute) return;
  n.tabIndex = -1;
  n.setAttribute('aria-hidden', 'true');
}
export function ToolRow({ label, hint, value, onChange, testID }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void; testID: string }) {
  const hintId = `${testID}-hint`;
  const web = Platform.OS === 'web' ? webSwitchProps(value, hintId, onChange) : {};
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value }}
      testID={`${testID}-row`}
      // 1.4.16 (QA V1415-4): inner padding (negative margin keeps the layout) so the focus ring doesn't touch the label
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 6, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 10 }}
      {...(web as object)}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }} nativeID={hintId}>{hint}</Text>
      </View>
      {/* 1.4.16 (QA V1415-2, web): the row is the ONE switch – react-native-web's Switch renders a focusable
          <input role=switch>, a second Tab stop / a switch inside a switch. On web the switch is only a picture:
          out of the tab order and the accessibility tree (aria-hidden, tabIndex -1), and taps on it reach the row. */}
      <View {...(Platform.OS === 'web' ? ({ 'aria-hidden': true, pointerEvents: 'none' } as object) : {})} testID={`${testID}-visual`}>
        <Switch value={value} onValueChange={onChange} testID={testID} accessible={false} importantForAccessibility="no" ref={hideFromWeb as never} />
      </View>
    </Pressable>
  );
}

