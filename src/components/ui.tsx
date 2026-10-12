import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { letterSpacing } from '../i18n/format';
import { clampInput, cleanText } from '../core/text';
import { colors, font, onColor, radius, readableFill, shadow, space, swatchRing } from '../theme';
import { PressableScale } from './PressableScale';
import { PRESSABLE_CARD_ROLE } from './a11yRoles';
import { useInsets } from './SafeFooter';

const DISABLED = { bg: colors.disabledBg, fg: colors.disabledText };

export function Screen({
  children,
  scroll = true,
  style,
  edges = ['top'],
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom')[];
  padded?: boolean;
}) {
  // 1.3.2: without the bottom edge, scrolling content still clears the Android nav bar (edge-to-edge).
  const insets = useInsets();
  const navPad = scroll && !edges.includes('bottom') ? insets.bottom : 0;
  const inner = padded ? { padding: space(4), paddingBottom: space(10) + navPad } : navPad ? { paddingBottom: navPad } : undefined;
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" testID="screen-scroll">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  // F135-5: Devanagari headings need room above the letters (the Hindi "टूर्नामेंट" title was cut / cramped)
  const { i18n } = useTranslation();
  const hi = i18n.language === 'hi';
  return <Text style={[font.h1, { color: colors.text }, hi && { lineHeight: 44, paddingTop: 6 }, style]} accessibilityRole="header">{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[font.h2, { color: colors.text, marginTop: space(5), marginBottom: space(2) }, style]}>{children}</Text>;
}
export function P({ children, style, muted, testID }: { children: React.ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; testID?: string }) {
  return <Text style={[font.body, { color: muted ? colors.muted : colors.text, lineHeight: 21 }, style]} testID={testID}>{children}</Text>;
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  big,
  testID,
  disabledHint,
}: {
  title: string;
  onPress?: () => void;
  variant?: BtnVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
  testID?: string;
  /** Shown under a disabled button: what is still missing (e.g. "Enter a 10-digit mobile number"). */
  disabledHint?: string;
}) {
  const v = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    dark: { bg: colors.ink, fg: colors.white, border: colors.ink },
    secondary: { bg: colors.white, fg: colors.ink, border: colors.ink },
    ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
    danger: { bg: colors.danger, fg: colors.white, border: colors.danger },
  }[variant];
  const off = !!disabled && !loading;
  const withHint = off && !!disabledHint;
  const fg = off ? DISABLED.fg : v.fg;
  const btn = (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      accessibilityHint={off ? disabledHint : undefined}
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        big && { paddingVertical: space(5) },
        { backgroundColor: v.bg, borderColor: v.border, opacity: pressed && !off ? 0.8 : 1 },
        !withHint && style,
        // Disabled: solid grey with dark grey text (5:1) instead of a faded colour (QA 216 minor).
        off && { backgroundColor: DISABLED.bg, borderColor: DISABLED.bg },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={big ? 24 : 20} color={fg} style={{ marginRight: 8 }} />}
          <Text style={[styles.btnText, big && { fontSize: 19 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </PressableScale>
  );
  if (!withHint) return btn;
  return (
    <View style={style}>
      {btn}
      <Text style={[styles.hint, { textAlign: 'center' }]} testID={testID ? `${testID}-hint` : undefined}>
        {disabledHint}
      </Text>
    </View>
  );
}

/** Lets a very long word (no spaces) wrap inside its box on web instead of overflowing. */
export const breakWords = (Platform.OS === 'web' ? { wordBreak: 'break-word', overflowWrap: 'anywhere' } : {}) as TextStyle;

export function Card({ children, style, onPress, accessibilityLabel, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; testID?: string }) {
  if (onPress)
    return (
      <PressableScale accessibilityRole={PRESSABLE_CARD_ROLE} accessibilityLabel={accessibilityLabel} testID={testID} onPress={onPress} scaleTo={0.98} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }, style]}>
        {children}
      </PressableScale>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * 1.3.7 (R136-15): `error` shows a message under the field, a red border and marks the input invalid
 * for screen readers (aria-invalid on web, the message joined to the label on native).
 */
export function Field({ label, hint, error, inputRef, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null; inputRef?: React.Ref<TextInput> }) {
  const tid = props.testID;
  return (
    <View style={{ marginBottom: space(4) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        placeholderTextColor={colors.placeholder}
        // 1.4.1 (QA V140-14): the visible label is the field's accessible name unless one is given (web had none)
        accessibilityLabel={error ? `${label.replace(/\s*\*$/, '')}, ${error}` : (props.accessibilityLabel ?? label.replace(/\s*\*$/, ''))}
        aria-invalid={!!error}
        {...props}
        style={[styles.input, props.style, error ? { borderColor: colors.danger, borderWidth: 2, outlineColor: colors.danger } : null]}
      />
      {error ? (
        <Text style={[styles.hint, { color: colors.danger, fontWeight: '700' }]} accessibilityLiveRegion="polite" testID={tid ? `${tid}-error` : undefined}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint} testID={tid ? `${tid}-hint` : undefined}>{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * A text field with a length limit that says what happened (QA B121-7): a paste longer than `max` keeps
 * the first `max` characters and shows a notice (no silent cut), and a value shorter than `min` shows
 * `shortText` once the user has typed something.
 */
export function LimitedField({
  max,
  min = 0,
  value,
  onChangeText,
  cutText,
  shortText,
  testID,
  ...props
}: Omit<TextInputProps, 'maxLength' | 'onChangeText' | 'value'> & { label: string; hint?: string; value: string; onChangeText: (v: string) => void; max: number; min?: number; cutText: string; shortText?: string }) {
  const [cut, setCut] = React.useState(false);
  const len = cleanText(value).length;
  const short = !!shortText && len > 0 && len < min;
  return (
    <View>
      <Field
        {...props}
        value={value}
        testID={testID}
        onChangeText={(raw) => {
          const r = clampInput(raw, max);
          setCut(r.cut);
          onChangeText(r.value);
        }}
        style={[props.style, (cut || short) && { borderColor: cut ? colors.primaryText : colors.danger }]}
      />
      {cut ? (
        <Text style={[styles.hint, { color: colors.primaryText, fontWeight: '700', marginTop: -space(3), marginBottom: space(3) }]} accessibilityLiveRegion="polite" testID={testID ? `${testID}-cut` : undefined}>
          {cutText}
        </Text>
      ) : short ? (
        <Text style={[styles.hint, { color: colors.danger, marginTop: -space(3), marginBottom: space(3) }]} accessibilityLiveRegion="polite" testID={testID ? `${testID}-short` : undefined}>
          {shortText}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  color,
  testID,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
  testID?: string;
  /** e.g. a time that has already passed today (QA G9/B2). */
  disabled?: boolean;
}) {
  return (
    <PressableScale
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      scaleTo={0.94}
      style={[styles.chip, active && { backgroundColor: color ?? colors.ink, borderColor: color ?? colors.ink }, disabled && { opacity: 0.45, borderStyle: 'dashed' }]}
    >
      <Text style={[styles.chipText, active && { color: onColor(color ?? colors.ink) }, disabled && { textDecorationLine: 'line-through' }]}>{label}</Text>
    </PressableScale>
  );
}

export function Row({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View style={[styles.row, style]} testID={testID}>{children}</View>;
}

export function Avatar({ name, uri, size = 40, color = colors.ink2, ring = false }: { name: string; uri?: string | null; size?: number; color?: string; /** B121-6: contrast ring when the fill is near navy */ ring?: boolean }) {
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  // Initials are small text: the fill is adjusted until black or white reaches 4.5:1 (QA contrast pass).
  const fill = readableFill(color);
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }, ring ? swatchRing(fill) : null]} testID="avatar-initials">
      <Text style={{ color: onColor(fill), fontWeight: '900', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

/** A team-colour dot with the B121-6 contrast ring (navy Team B never passes for a text bullet). */
export function TeamDot({ color, size = 12, style, testID }: { color: string; size?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, swatchRing(color, size <= 12 ? 1.5 : 2), style]} testID={testID} />;
}

export function LiveBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.live}>
      <View style={styles.liveDot} />
      <Text style={[styles.liveText, { letterSpacing: letterSpacing(1) }]}>{t('common.live')}</Text>
    </View>
  );
}

export function Empty({ icon = 'trophy-outline', title, text }: { icon?: keyof typeof Ionicons.glyphMap; title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space(6) }}>
      <Ionicons name={icon} size={40} color={colors.muted} />
      <Text style={[font.h3, { marginTop: 8, color: colors.text }]}>{title}</Text>
      {text ? <P muted style={{ textAlign: 'center', marginTop: 4 }}>{text}</P> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <ActivityIndicator size="large" color={colors.ink} />
    </View>
  );
}

export function Banner({
  text,
  tone = 'info',
  testID,
  action,
}: {
  text: string;
  tone?: 'info' | 'warn';
  testID?: string;
  /** Optional link under the text (e.g. "Update mobile number"). */
  action?: { label: string; onPress: () => void; testID?: string };
}) {
  return (
    <View style={[styles.banner, tone === 'warn' && { backgroundColor: colors.warnBg, borderColor: colors.primaryText }]} testID={testID}>
      <Ionicons name={tone === 'warn' ? 'warning' : 'information-circle'} size={18} color={colors.ink} />
      <View style={{ marginLeft: 8, flex: 1 }}>
        <Text style={[font.small, { color: colors.ink, flexShrink: 1 }]}>{text}</Text>
        {action && (
          <Pressable onPress={action.onPress} accessibilityRole={PRESSABLE_CARD_ROLE} testID={action.testID} hitSlop={8}>
            <Text style={[font.small, { color: colors.primaryText, fontWeight: '800', textDecorationLine: 'underline', marginTop: 4 }]}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center' },
  btn: {
    borderRadius: radius.pill,
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginVertical: space(1.5),
  },
  btnText: { fontSize: 16, fontWeight: '800' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space(4),
    marginBottom: space(3),
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadow,
  },
  label: { ...font.small, color: colors.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  input: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    fontSize: 17,
    color: colors.text,
    fontWeight: '600',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: { fontWeight: '800', color: colors.text, fontSize: 14 },
  live: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.live, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white, marginRight: 5 },
  liveText: { color: colors.white, fontWeight: '900', fontSize: 11, letterSpacing: 1 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space(3),
    marginBottom: space(3),
  },
});

export { PRESSABLE_CARD_ROLE };
