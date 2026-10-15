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
import { colors, currentTheme, elevation, type, themed, tokens } from '../theme';
import { StepDots } from '../components/DayNightKit';
import { signInReasonKey } from '../state/signInReason';
import { Blob, Body, Display, Glow, KButton, Over, useKit } from '../components/DNKit';
const T = () => tokens[currentTheme()];
const DAY = () => currentTheme() === 'day';

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
  const k = useKit();
  // 1.4.22 (QA V1421-5): why Login opened (a signed-out user asked for /ask or another sign-in-only screen)
  const [reasonKey] = useState(() => signInReasonKey());
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
      style={{ backgroundColor: k.t.bg }}
      edges={['top', 'bottom']}
      padded={false}
      contentContainerStyle={{ flexGrow: 1 }}
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, minHeight: 52 }}>
          {session && (
            <Pressable onPress={changeNumber} accessibilityRole="button" accessibilityLabel={t('login.changeNumber')} hitSlop={8} style={{ width: 44, height: 44, justifyContent: 'center' }} testID="otp-back">
              <Ionicons name="arrow-back" size={24} color={k.t.text} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          <LanguageSwitch showLabel={false} />
        </View>
      }
      testID="login-screen"
    >
      <StatusBar style={k.t.statusBar} />
      {/* 1.4.22 (spec v2 *-06-login-keyboard): step dots "Step 1 of 3", display title, MOBILE NUMBER field and Send code
          right below it so both stay above the keyboard. Day: Ball blob top-right; Night: Volt glow. */}
      {k.day ? <Blob color={k.t.accent} size={220} style={{ top: -120, right: -80 }} /> : <Glow color={k.t.primary} size={240} style={{ top: -120, right: -100 }} opacity={0.25} />}
      {!session ? (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: compact ? 0 : 4 }} testID={compact ? 'login-brand-compact' : 'login-brand'}>
            <StepDots step={0} total={3} testID="login-steps" />
          </View>
          {SHOW_DEMO_OTP && <View style={{ marginTop: 10 }}><Banner tone="warn" text={t('login.demoBanner', { code: DEMO_OTP })} /></View>}
          <Display size={compact ? 30 : 36} style={{ marginTop: compact ? 12 : 22 }} accessibilityRole="header" testID="login-title">{k.day ? t('dn.loginTitleDay') : t('dn.loginTitleNight')}</Display>
          {reasonKey ? <View style={{ marginTop: 12 }} accessibilityLiveRegion="polite"><Banner tone="warn" text={t(reasonKey)} testID="login-reason" /></View> : null}
          <Body muted bold size={15} style={{ marginTop: 6, marginBottom: compact ? 12 : 18 }}>{t('dn.loginSub')}</Body>
          <Over style={{ marginBottom: 6 }} color={k.t.text}>{t('common.mobileNumber')}</Over>
          <PhoneInput digitsOnly label="" value={phone} onChangeText={onPhone} onShownInvalid={setShownInvalid} size="lg" testID="phone-input" onSubmitEditing={() => canSend && send()} returnKeyType="send" />
          <KButton title={t('dn.sendCode')} icon="arrow-forward" onPress={send} loading={busy} disabled={!canSend} accessibilityLabel={canSend ? t('dn.sendCode') : `${t('dn.sendCode')}. ${t('login.sendOtpHint')}`} style={{ marginTop: 4 }} testID="send-otp" />
          {!canSend ? <Body muted size={12} style={{ marginTop: 6 }} testID="send-otp-hint">{t('login.sendOtpHint')}</Body> : null}
          {error && <ErrorLine text={error} />}
          <Body muted size={12} style={{ marginTop: 16 }}>{t('login.welcomeText')}</Body>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {/* 1.4.22 (spec v2 *-10-otp): Step 2 of 3, title, 6 cells 46×58 (Day ink border + hard shadow on focus) */}
          <StepDots step={1} total={3} testID="otp-steps" />
          {SHOW_DEMO_OTP && <View style={{ marginTop: 10 }}><Banner tone="warn" text={t('login.demoBanner', { code: DEMO_OTP })} /></View>}
          <Display size={32} style={{ marginTop: 18 }} accessibilityRole="header">{t('login.enterTitle')}</Display>
          <Text style={[type.body, { color: k.t.textMuted, marginTop: 4, fontSize: 15 }, k.f.body]} testID="otp-sent-to">
            {t('login.sentTo', { phone: formatPhone(e164) })}
            {' · '}
            <Text style={{ color: k.day ? k.t.teamAText : k.t.primary, fontWeight: '700' }} onPress={changeNumber} accessibilityRole="button" testID="otp-change">
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
            <Text style={[type.body, { color: k.t.textMuted, flex: 1 }]}>{t('login.didntGet')}</Text>
            {left > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="otp-resend-wait">
                <Ionicons name="time-outline" size={16} color={k.t.textMuted} />
                <Text style={[type.body, { color: k.t.textMuted }]}>{t('login.resendIn', { s: `0:${String(left).padStart(2, '0')}` })}</Text>
              </View>
            ) : (
              <Pressable onPress={resend} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} testID="otp-resend">
                <Text style={{ color: k.day ? k.t.teamAText : k.t.primary, fontWeight: '700', fontSize: 15 }}>{t('login.resend')}</Text>
              </Pressable>
            )}
          </View>
          <KButton title={t('login.verify')} icon="shield-checkmark-outline" onPress={confirm} loading={busy} disabled={code.length < 6} accessibilityLabel={code.length < 6 ? `${t('login.verify')}. ${t('login.verifyHint')}` : t('login.verify')} style={{ marginTop: 16 }} testID="verify-otp" />
          {code.length < 6 ? <Body muted size={12} style={{ marginTop: 6 }} testID="verify-otp-hint">{t('login.verifyHint')}</Body> : null}
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
      <Ionicons name="alert-circle" size={16} color={T().live} />
      <Text style={{ color: T().live, fontWeight: '600', fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

const RESEND_S = 30;

const s = themed(() => StyleSheet.create({
  logoCompact: { width: 52, height: 52, borderRadius: 16 },
  logo: { width: 84, height: 84, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...elevation.glowPrimary },
  sheet: { flex: 1, backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, paddingTop: 24 },
  feat: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  otpIcon: { width: 96, height: 96, borderRadius: 24, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  lock: { position: 'absolute', top: -10, right: -10, width: 36, height: 36, borderRadius: 10, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  boxes: { flexDirection: 'row', gap: 8, marginTop: 24 },
  box: { flex: 1, height: 58, borderRadius: 14, borderWidth: DAY() ? 2 : 1, borderColor: DAY() ? T().outline : T().outline, backgroundColor: T().surface, alignItems: 'center', justifyContent: 'center' },
  boxFilled: { borderColor: DAY() ? T().outline : T().textMuted, backgroundColor: T().surface },
  boxCurrent: DAY() ? { borderWidth: 2, borderColor: T().outline, shadowColor: T().primary, shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 3, height: 3 } } : { borderWidth: 2, borderColor: T().primary, shadowColor: T().primary, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  boxWrong: { borderColor: T().live },
  boxText: { fontSize: 26, fontFamily: T().font.display, color: T().text },
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: 'transparent' },
}));
