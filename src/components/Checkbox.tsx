/**
 * 1.5.9 (Tester F158-8): the ONE shared checkbox. react-native-web only maps Space to a press for role=button, so a
 * role=checkbox Pressable ignored Space (WAI-ARIA: Space toggles a checkbox) – the web props add aria-checked and a
 * Space handler (same approach as ToolRow's switch, QA V1414-1); native gets accessibilityActions 'activate' so
 * TalkBack / VoiceOver double-tap and the "activate" action both toggle it.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, themed, type } from '../theme';

/** web-only attributes: aria-checked + Space toggles (Enter is left to the page, e.g. a form's submit). */
export function webCheckboxProps(checked: boolean, onChange: (v: boolean) => void) {
  return {
    'aria-checked': checked,
    onKeyDown: (e: { key?: string; repeat?: boolean; preventDefault?: () => void }) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault?.(); // no page scroll
        if (!e.repeat) onChange(!checked);
      }
    },
  };
}

export const CHECKBOX_ACTIONS = Object.freeze([{ name: 'activate' as const }]);
export function onCheckboxAction(checked: boolean, onChange: (v: boolean) => void) {
  return (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') onChange(!checked);
  };
}

export function Checkbox({ checked, onChange, label, testID, style, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string; style?: StyleProp<ViewStyle>; disabled?: boolean }) {
  const set = (v: boolean) => { if (!disabled) onChange(v); };
  const web = Platform.OS === 'web' ? webCheckboxProps(checked, set) : {};
  return (
    <Pressable
      onPress={() => set(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityActions={CHECKBOX_ACTIONS as unknown as { name: 'activate' }[]}
      onAccessibilityAction={onCheckboxAction(checked, set)}
      style={[s.check, style]}
      testID={testID}
      {...(web as object)}
    >
      <View style={[s.box, checked && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
        {checked ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
      </View>
      <Text style={[type.body, { color: colors.text, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

const s = themed(() => StyleSheet.create({
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 48, marginTop: 8 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
}));
