/**
 * Shared Indian mobile number input: fixed "+91" prefix, 10 ASCII digits, inline validation.
 *
 * The value is the 10 national digits (never the prefix); use `toE164(value)` from core/phone to
 * store or send it. Every change goes through `nextPhoneField` (core/phone), so the field behaves
 * the same on web, Android and iOS (QA build-217 browser pass #3):
 *  - the digits never exceed 10: once there are 10, a further typed digit is ignored (the field
 *    stays as it was, no error), so typing digit by digit can never get past 10;
 *  - a paste (or autofill) is cleaned first by `sanitizePhoneInput` (spaces, dashes, brackets,
 *    dots, a leading +91 / 0091 / 91 / 0; Devanagari digits become 0-9): if that gives at most 10
 *    digits they are used;
 *  - text that can't be cleaned to 10 digits (12 digits, letters, emoji, another country code)
 *    stays visible in the field next to the inline error, so the user sees why (the same as
 *    typing "abc"); the value keeps its last valid digits;
 *  - a country code still being typed ("+", "+9", "+91") is shown with no error and no digits
 *    yet (QA N3).
 *
 * The native maxLength is 20 characters (QA N1) so a "+91 (98765) 43210" paste reaches the cleaner
 * whole instead of being cut by the platform first; the 10-digit limit is enforced here, not by
 * maxLength.
 */
import React, { forwardRef, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';
import { COUNTRY_CODE, filterPhoneTyping, isValidMobile, nextPhoneField } from '../core/phone';
import { colors } from '../theme';
import { styles as ui } from './ui';

export const PASTE_ROOM = 20;
const NO_WEB_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as TextStyle;

export interface PhoneInputProps {
  value: string;
  onChangeText: (national: string) => void;
  label?: string;
  hint?: string;
  testID?: string;
  size?: 'md' | 'lg';
  editable?: boolean;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  returnKeyType?: TextInputProps['returnKeyType'];
  autoFocus?: boolean;
  /**
   * Retest 1.1.0 NB-U1: told whether the field currently SHOWS text other than its valid value
   * (refused letters, a partial "+91"), so a submit button can stay disabled while an error shows.
   */
  onShownInvalid?: (invalid: boolean) => void;
  /**
   * QA B121-8 (1.3.1): drop anything that isn't a digit as it is typed or pasted (add-player fields),
   * with a short "digits only" note, instead of keeping the refused text visible next to an error.
   */
  digitsOnly?: boolean;
  /** 1.4.17 (QA V1416-3): called on focus (e.g. the shared scroll-into-view, useFocusReveal). */
  onFocus?: () => void;
  blurOnSubmit?: boolean;
}

/**
 * Whether to show the inline error while typing: once the field has been touched (anything typed,
 * or focus left) and the digits aren't a valid mobile yet. An empty field shows nothing (its
 * submit button is disabled anyway), so clearing it after a successful add doesn't flash an error.
 */
export const showPhoneError = (value: string, touched: boolean) => touched && value !== '' && !isValidMobile(value);

export const PhoneInput = forwardRef<TextInput, PhoneInputProps>(function PhoneInput(
  { value, onChangeText, label, hint, testID = 'phone', size = 'md', editable = true, onSubmitEditing, returnKeyType = 'done', autoFocus, onShownInvalid, digitsOnly = false, onFocus, blurOnSubmit },
  ref,
) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  /** Last change was refused (letters, emoji, other country code, too long): say so instead of failing silently. */
  const [rejected, setRejected] = useState(false);
  /**
   * Text shown instead of the value: a partly typed "+91" (no error, QA N3), or text that was
   * refused ("abc"), kept visible next to its error so the field never silently empties (QA 216).
   */
  const [display, setDisplay] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  /** Focus has left the field since the last change (B121-8). */
  const [left, setLeft] = useState(false);
  /** digitsOnly: the last change had characters removed. */
  const [dropped, setDropped] = useState(false);
  // The parent changed the value (e.g. cleared it after adding a player): show the value again.
  const shownFor = useRef(value);
  if (shownFor.current !== value) {
    shownFor.current = value;
    if (display !== null) {
      setDisplay(null);
      onShownInvalid?.(false);
    }
  }
  const lg = size === 'lg';
  // QA B121-8: text left in the field that isn't a number yet (a bare "+91", refused letters) is an
  // error once focus leaves it, even though the value behind it is still empty.
  const err = rejected || showPhoneError(value, touched) || (display !== null && left);
  const change = (raw: string) => {
    const n = digitsOnly ? filterPhoneTyping({ value, display }, raw) : { ...nextPhoneField({ value, display }, raw), dropped: false };
    setDropped(n.dropped);
    setDisplay(n.display);
    setRejected(n.rejected);
    setTouched(true);
    setLeft(false);
    onShownInvalid?.(n.display !== null || n.rejected);
    // An ignored 11th digit or refused text re-sends the current value, so a controlled native
    // field snaps back to it (web and Android alike).
    onChangeText(n.value);
  };
  return (
    <View style={{ marginBottom: label || hint || err || dropped ? 12 : 0 }}>
      {label ? <Text style={ui.label}>{label}</Text> : null}
      <View
        // The focus ring is this rounded border (the inner web input's own square outline is off).
        style={[ui.input, { flexDirection: 'row', alignItems: 'center', paddingVertical: 0 }, focused && { borderColor: colors.primaryText }, err && { borderColor: colors.danger }]}
        testID={`${testID}-box`}
      >
        <Text
          style={{ fontSize: lg ? 18 : 16, fontWeight: '800', marginRight: 8, color: colors.text }}
          accessibilityLabel={t('common.countryCodeA11y')}
          testID={`${testID}-prefix`}
        >
          +{COUNTRY_CODE}
        </Text>
        <TextInput
          ref={ref}
          value={display ?? value}
          onChangeText={change}
          onFocus={() => {
            setFocused(true);
            setLeft(false);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            setLeft(true);
            setTouched(true);
          }}
          placeholder="98765 43210"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          maxLength={PASTE_ROOM}
          accessibilityLabel={label ?? t('common.mobileNumber')}
          accessibilityHint={err ? t('common.invalidMobile') : undefined}
          aria-invalid={err}
          editable={editable}
          autoFocus={autoFocus}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          blurOnSubmit={blurOnSubmit}
          style={[{ flex: 1, fontSize: lg ? 18 : 16, paddingVertical: lg ? 14 : 12, fontWeight: '700', color: colors.text }, NO_WEB_OUTLINE]}
          testID={testID}
        />
      </View>
      {dropped ? (
        // Shown with (above) the "enter a valid mobile" error while the number is still short, so the
        // user learns why the letters vanished (B121-8).
        <Text style={[ui.hint, { color: colors.primaryText, fontWeight: '700' }]} testID={`${testID}-digits-only`} accessibilityLiveRegion="polite">
          {t('common.digitsOnly')}
        </Text>
      ) : null}
      {err ? (
        <Text style={{ color: colors.danger, fontWeight: '700', marginTop: 4 }} testID={`${testID}-error`} accessibilityRole="alert">
          {t('common.invalidMobile')}
        </Text>
      ) : hint && !dropped ? (
        <Text style={ui.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});
