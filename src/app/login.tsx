import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { PhoneInput } from '../components/PhoneInput';
import { PhoneVerifierHost, type PhoneVerifierHandle } from '../components/PhoneVerifier';
import { Banner, Button } from '../components/ui';
import { haptic } from '../services/haptics';
import { devanagariToAscii, formatPhone, isValidMobile, toE164 } from '../core/phone';
import { backend, type OtpSession } from '../services/backend';
import { DEMO_OTP, SHOW_DEMO_OTP, USES_FIREBASE_AUTH } from '../services/config';
import { translateError } from '../i18n/format';
import { colors, elevation, type } from '../theme';

/**
 * Room for a pasted code with separators ("123 456", "12-34-56"): the native limit must not cut the
 * paste before the digit filter runs (QA N2). The filter keeps the first 6 digits.
 */
export const OTP_PASTE_ROOM = 12;
export const cleanOtp = (raw: string) => devanagariToAscii(raw).replace(/[^0-9]/g, '').slice(0, 6);

/** QA B121-3: below this window height the brand block is compact, so "Send OTP" is on the first screen (360×640, EN and HI). */
export const COMPACT_LOGIN_HEIGHT = 720;
export const isCompactLogin = (windowHeight: number) => windowHeight < COMPACT_LOGIN_HEIGHT;

export default function Login() {
  const { t } = useTranslation();
  const compact = isCompactLogin(useWindowDimensions().height);
  const verifier = useRef<PhoneVerifierHandle>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [session, setSession] = useState<OtpSession | null>(null);
  const [e164, setE164] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Retest 1.1.0 NB-U1: the field shows refused text (e.g. "9876543210a"): Send stays disabled.
  const [shownInvalid, setShownInvalid] = useState(false);
  const canSend = isValidMobile(phone) && !shownInvalid;
  const otpRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const [wrong, setWrong] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!session || left <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session, left]);

  // QA B4: a stale "invalid number" / send error must not outlive the number it was about.
  const onPhone = (n: string) => {
    setPhone(n);
    if (error) setError(null);
  };

  const send = async () => {
    setError(null);
    const n = shownInvalid ? null : toE164(phone);
    if (!n) return setError(t('login.invalidPhone'));
    setBusy(true);
    try {
      const s = await backend.sendOtp(n, USES_FIREBASE_AUTH ? verifier.current?.getVerifier() ?? null : null);
      setE164(n);
      setSession(s);
      setResendAt(Date.now() + RESEND_S * 1000);
      setNow(Date.now());
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!session) return;
    setError(null);
    setBusy(true);
    try {
      await session.confirm(code);
    } catch (e) {
      setError(translateError(e));
      setWrong(true);
      haptic('error');
      setBusy(false);
    }
  };
  const changeNumber = () => {
    setSession(null);
    setCode('');
    setError(null);
  };

  const resend = async () => {
    setCode('');
    await send();
    setResendAt(Date.now() + RESEND_S * 1000);
  };

  return (
    <KeyboardAwareScreen
      style={{ backgroundColor: session ? colors.white : colors.ink }}
      edges={['top', 'bottom']}
      padded={false}
      contentContainerStyle={{ flexGrow: 1 }}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, minHeight: 52 }}>
          {session && (
            <Pressable onPress={changeNumber} accessibilityRole="button" accessibilityLabel={t('login.changeNumber')} hitSlop={8} style={{ width: 44, height: 44, justifyContent: 'center' }} testID="otp-back">
              <Ionicons name="arrow-back" size={24} color={colors.ink} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          <LanguageSwitch dark={!session} showLabel={false} />
        </View>
      }
      testID="login-screen"
    >
      <StatusBar style={session ? 'dark' : 'light'} />
      {!session ? (
        <View style={{ flex: 1 }}>
          <View style={{ alignItems: 'center', paddingTop: compact ? 0 : 12, paddingBottom: compact ? 18 : 56 }} testID={compact ? 'login-brand-compact' : 'login-brand'}>
            <View style={[s.logo, compact && s.logoCompact]}>
              <MaterialCommunityIcons name="volleyball" size={compact ? 32 : 52} color={colors.ink} />
            </View>
            <Text style={{ color: colors.white, marginTop: compact ? 6 : 14, fontSize: compact ? 26 : 34, fontWeight: '900' }}>VolleyLive</Text>
            <Text style={{ color: colors.onInkMuted, fontSize: compact ? 14 : 16, marginTop: compact ? 2 : 4, fontWeight: '500' }}>{t('login.tagline')}</Text>
          </View>
          <View style={[s.sheet, compact && { paddingTop: 16 }]}>
            {SHOW_DEMO_OTP && <Banner tone="warn" text={t('login.demoBanner', { code: DEMO_OTP })} />}
            <Text style={[type.display, { color: colors.text }, compact && { fontSize: 24, lineHeight: 30 }]}>{t('login.welcome')}</Text>
            <Text style={[type.body, { color: colors.muted, marginTop: 4, marginBottom: compact ? 10 : 16, fontSize: compact ? 14 : 15, lineHeight: compact ? 20 : 22 }]}>{t('login.welcomeText')}</Text>
            <PhoneInput digitsOnly label={t('common.mobileNumber')} value={phone} onChangeText={onPhone} onShownInvalid={setShownInvalid} size="lg" testID="phone-input" onSubmitEditing={() => canSend && send()} returnKeyType="send" />
            <Button title={t('login.sendOtp')} icon="arrow-forward" onPress={send} loading={busy} disabled={!canSend} disabledHint={t('login.sendOtpHint')} big style={{ marginTop: 4 }} testID="send-otp" />
            {error && <ErrorLine text={error} />}
            <View style={{ flexDirection: 'row', marginTop: 22 }}>
              {(
                [
                  ['radio', 'login.featLive'],
                  ['podium', 'login.featRank'],
                  ['camera', 'login.featPhotos'],
                ] as const
              ).map(([icon, key]) => (
                <View key={key} style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
                  <View style={s.feat}>
                    <Ionicons name={icon} size={22} color={colors.ink} />
                  </View>
                  <Text style={[type.caption, { color: colors.text, textAlign: 'center', marginTop: 6 }]}>{t(key)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {SHOW_DEMO_OTP && <Banner tone="warn" text={t('login.demoBanner', { code: DEMO_OTP })} />}
          <View style={s.otpIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.ink} />
            <View style={s.lock}>
              <Ionicons name="lock-closed" size={22} color={colors.white} />
            </View>
          </View>
          <Text style={[type.display, { color: colors.text, marginTop: 20 }]} accessibilityRole="header">
            {t('login.enterTitle')}
          </Text>
          <Text style={[type.body, { color: colors.muted, marginTop: 4, fontSize: 15 }]} testID="otp-sent-to">
            {t('login.sentTo', { phone: formatPhone(e164) })}
            {' · '}
            <Text style={{ color: colors.primaryText, fontWeight: '700' }} onPress={changeNumber} accessibilityRole="button" testID="otp-change">
              {t('login.change')}
            </Text>
          </Text>
          <Pressable onPress={() => otpRef.current?.focus()} style={s.boxes} accessible={false}>
            {Array.from({ length: 6 }, (_, i) => {
              const filled = i < code.length;
              const current = i === code.length;
              return (
                <View key={i} style={[s.box, filled && s.boxFilled, current && s.boxCurrent, wrong && s.boxWrong]} testID={`otp-box-${i}`}>
                  <Text style={s.boxText}>{code[i] ?? (current ? '|' : '')}</Text>
                </View>
              );
            })}
            <TextInput
              ref={otpRef}
              value={code}
              onChangeText={(v) => {
                setCode(cleanOtp(v));
                if (wrong) setWrong(false);
              }}
              maxLength={OTP_PASTE_ROOM}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              autoFocus
              caretHidden
              accessibilityLabel={t('login.codeBoxes', { n: code.length })}
              style={s.hiddenInput}
              testID="otp-input"
            />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
            <Text style={[type.body, { color: colors.muted, flex: 1 }]}>{t('login.didntGet')}</Text>
            {left > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="otp-resend-wait">
                <Ionicons name="time-outline" size={16} color={colors.muted} />
                <Text style={[type.body, { color: colors.muted }]}>{t('login.resendIn', { s: `0:${String(left).padStart(2, '0')}` })}</Text>
              </View>
            ) : (
              <Pressable onPress={resend} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID="otp-resend">
                <Text style={{ color: colors.primaryText, fontWeight: '700', fontSize: 15 }}>{t('login.resend')}</Text>
              </Pressable>
            )}
          </View>
          <Button title={t('login.verify')} icon="shield-checkmark-outline" onPress={confirm} loading={busy} disabled={code.length < 6} disabledHint={t('login.verifyHint')} big style={{ marginTop: 16 }} testID="verify-otp" />
          {error && <ErrorLine text={error} />}
        </View>
      )}
      {USES_FIREBASE_AUTH && <PhoneVerifierHost ref={verifier} />}
    </KeyboardAwareScreen>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.lossText} />
      <Text style={{ color: colors.lossText, fontWeight: '600', fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

const RESEND_S = 30;

const s = StyleSheet.create({
  logoCompact: { width: 52, height: 52, borderRadius: 16 },
  logo: { width: 84, height: 84, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...elevation.glowPrimary },
  sheet: { flex: 1, backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingTop: 24 },
  feat: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  otpIcon: { width: 96, height: 96, borderRadius: 24, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  lock: { position: 'absolute', top: -10, right: -10, width: 36, height: 36, borderRadius: 10, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  boxes: { flexDirection: 'row', gap: 8, marginTop: 24 },
  box: { flex: 1, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  boxFilled: { borderColor: colors.ink, backgroundColor: colors.white },
  boxCurrent: { borderWidth: 2, borderColor: colors.primaryText, backgroundColor: colors.white },
  boxWrong: { borderColor: colors.lossText },
  boxText: { fontSize: 24, fontWeight: '800', color: colors.text },
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: 'transparent' },
});
