import * as ImagePicker from 'expo-image-picker';
import { LIMITS } from '../core/limits';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { POSITIONS, type Position, type UserProfile } from '../core/types';
import { backend } from '../services/backend';
import { useAuth } from '../state/AuthContext';
import { positionLabel, translateError } from '../i18n/format';
import { colors } from '../theme';
import { Avatar, Banner, Button, Chip, Field, styles as ui } from './ui';
import { checkProfileFields } from '../core/validate';
import { photoSizeProblem } from '../core/photos';
import { isValidE164 } from '../core/phone';
import { ageFromDob, asciiDigits, checkRegistrationUpdate, fullName, MAX_AGE, NAME_MAX, PINCODE_RE, registrationFieldErrors, type FieldProblem, type PincodeInfo, type RegField } from '../core/registration';
import { MIN_AGE, SUPPORT_EMAIL } from '../services/config';
import { signOut } from '../services/session';
import { DobPicker } from './DobPicker';

type Input = TextInput;

export function ProfileForm({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [name] = useState(profile?.name ?? '');
  // 1.3.6 registration: older profiles only have `name` – split it as a starting point.
  const parts = (profile?.name ?? '').trim().split(/\s+/);
  const [firstName, setFirstName] = useState(profile?.firstName ?? (profile?.lastName ? '' : parts[0] ?? ''));
  const [lastName, setLastName] = useState(profile?.lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : ''));
  const [dob, setDob] = useState(profile?.dob ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [pincode, setPincode] = useState(profile?.pincode ?? '');
  const [pin, setPin] = useState<{ pin: string; info: PincodeInfo | 'checking' } | null>(null);
  const age = dob ? ageFromDob(dob) : null;
  useEffect(() => {
    if (!PINCODE_RE.test(pincode)) return setPin(null);
    let alive = true;
    setPin({ pin: pincode, info: 'checking' });
    (backend.lookupPincode ? backend.lookupPincode(pincode) : Promise.resolve({ status: 'unknown' } as PincodeInfo))
      .catch(() => ({ status: 'unknown' }) as PincodeInfo)
      .then((info) => alive && setPin({ pin: pincode, info }));
    return () => {
      alive = false;
    };
  }, [pincode]);
  const [city, setCity] = useState(profile?.city ?? '');
  const [position, setPosition] = useState<Position>(profile?.position ?? 'any');
  const [photo, setPhoto] = useState<string | null>(profile?.photoURL ?? null);
  const [localPhoto, setLocalPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1.3.7 (R136-8): the DOB is outside the allowed ages – say so clearly and offer a way out
  const [ageBlocked, setAgeBlocked] = useState(false);
  // 1.3.7 (R136-15): inline errors under each field once Save was pressed (live after that), the
  // server's field errors too, and focus on the first field with a problem.
  const [submitted, setSubmitted] = useState(false);
  const [serverField, setServerField] = useState<FieldProblem | null>(null);
  const [pinNote, setPinNote] = useState(false); // R136-17: a non-digit was typed in the pincode
  const refs = { firstName: useRef<Input>(null), lastName: useRef<Input>(null), pincode: useRef<Input>(null), email: useRef<Input>(null) };
  const ORDER: RegField[] = ['firstName', 'lastName', 'dob', 'pincode', 'email'];
  const values = { firstName, lastName, dob, email, pincode };
  const fieldErrs = (): Partial<Record<RegField, FieldProblem>> => {
    const errs = registrationFieldErrors(values, profile, MIN_AGE);
    if (!errs.pincode && pin?.pin === pincode && pin.info !== 'checking' && pin.info.status === 'invalid') errs.pincode = { code: 'pincode_unknown', field: 'pincode' };
    if (serverField && !errs[serverField.field]) errs[serverField.field] = serverField;
    return errs;
  };
  const shownErrs = submitted || serverField ? fieldErrs() : {};
  const errText = (f: RegField) => (shownErrs[f] ? translateError(shownErrs[f], t) : null);
  const atLimit = (v: string) => [...v].length >= NAME_MAX;
  const focusFirst = (errs: Partial<Record<RegField, FieldProblem>>) => {
    const first = ORDER.find((f) => errs[f]);
    if (first && first !== 'dob') refs[first].current?.focus();
  };

  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (r.canceled) return;
    // QA G10: refuse an empty or 10 MB+ photo before uploading.
    const size = photoSizeProblem(r.assets[0].fileSize);
    if (size) return setError(t(`errors.codes.${size === 'empty' ? 'photo_empty' : 'photo_too_large'}`));
    setError(null);
    setLocalPhoto(r.assets[0].uri);
  };

  const save = async () => {
    if (!user) return;
    // Same checks as every backend (src/core/validate.ts): name 2-60, city blank or up to 80, never
    // whitespace-only (QA B3), no hidden/control characters (QA G14).
    let fields: { name: string; city: string };
    let reg: ReturnType<typeof checkRegistrationUpdate>;
    setAgeBlocked(false);
    setServerField(null);
    setSubmitted(true);
    // R136-15/16: validate exactly what is on screen now (not an earlier value), every field at once
    const errs = registrationFieldErrors(values, profile, MIN_AGE);
    if (!errs.pincode && pin?.pin === pincode && pin.info !== 'checking' && pin.info.status === 'invalid') errs.pincode = { code: 'pincode_unknown', field: 'pincode' };
    if (Object.keys(errs).length) {
      setError(null);
      if (errs.dob && (errs.dob.code === 'age_too_young' || errs.dob.code === 'age_too_old')) setAgeBlocked(true);
      focusFirst(errs);
      return;
    }
    try {
      // The stored DOB can be saved again even if it has left the age range since (R136-8).
      reg = checkRegistrationUpdate({ firstName, lastName, dob, email, pincode }, profile, MIN_AGE);
      fields = checkProfileFields({ name: fullName(reg.firstName, reg.lastName), city });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'age_too_young' || code === 'age_too_old') setAgeBlocked(true);
      return setError(translateError(e));
    }
    const found = pin?.pin === reg.pincode && pin.info !== 'checking' && pin.info.status === 'ok' ? pin.info : null;
    setBusy(true);
    setError(null);
    try {
      let photoURL = photo;
      if (localPhoto) photoURL = await backend.uploadAvatar(user.uid, localPhoto);
      const p: UserProfile = {
        id: user.uid,
        name: fields.name,
        phone: profile?.phone ?? user.phoneNumber ?? '',
        position,
        city: fields.city || found?.city || '',
        ...reg,
        district: found?.district ?? null,
        state: found?.state ?? null,
        photoURL: photoURL ?? null,
        createdAt: profile?.createdAt ?? Date.now(),
      };
      await backend.saveProfile(p);
      setPhoto(photoURL ?? null);
      onSaved?.();
    } catch (e) {
      const x = e as { code?: string; field?: string; min?: number; max?: number };
      if (x?.code === 'age_too_young' || x?.code === 'age_too_old') setAgeBlocked(true);
      // a field error from the server goes under its field; anything else above Save
      if (x?.code && x.field && (ORDER as string[]).includes(x.field)) {
        const f = x.field as RegField;
        setServerField({ code: x.code, field: f, min: x.min, max: x.max });
        setError(null);
        focusFirst({ [f]: true } as never);
      } else setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Pressable onPress={pickPhoto} style={{ alignItems: 'center', marginBottom: 20 }}>
        <Avatar name={name || '?'} uri={localPhoto ?? photo} size={96} />
        <Text style={{ color: colors.ink, fontWeight: '800', marginTop: 8 }}>{localPhoto || photo ? t('profileForm.changePhoto') : t('profileForm.addPhoto')}</Text>
      </Pressable>
      {profile?.phone && !isValidE164(profile.phone) && (
        <Banner tone="warn" text={t('profileForm.phoneOutdated', { phone: profile.phone })} testID="phone-outdated" />
      )}
      <Field
        label={`${t('profileForm.firstName')} *`}
        value={firstName}
        onChangeText={(v) => (setFirstName(v), setServerField(null))}
        placeholder={t('profileForm.firstNamePlaceholder')}
        autoCapitalize="words"
        maxLength={NAME_MAX}
        error={errText('firstName')}
        hint={atLimit(firstName) ? t('profileForm.atLimit', { max: NAME_MAX }) : undefined}
        inputRef={refs.firstName}
        testID="profile-first-name"
      />
      <Field
        label={`${t('profileForm.lastName')} *`}
        value={lastName}
        onChangeText={(v) => (setLastName(v), setServerField(null))}
        placeholder={t('profileForm.lastNamePlaceholder')}
        autoCapitalize="words"
        maxLength={NAME_MAX}
        error={errText('lastName')}
        hint={atLimit(lastName) ? t('profileForm.atLimit', { max: NAME_MAX }) : undefined}
        inputRef={refs.lastName}
        testID="profile-last-name"
      />
      <DobPicker label={`${t('profileForm.dob')} *`} value={dob} onChange={(v) => (setDob(v), setServerField(null))} minAge={MIN_AGE} error={errText('dob')} testID="profile-dob" />
      <View style={{ marginBottom: 16 }} accessible accessibilityLabel={`${t('profileForm.age')}: ${age != null ? t('profileForm.ageValue', { count: age }) : '–'}`}>
        <Text style={ui.label}>{t('profileForm.age')}</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color: age != null && (age < MIN_AGE || age > MAX_AGE) ? colors.danger : colors.text }} testID="profile-age">
          {age != null ? t('profileForm.ageValue', { count: age }) : '–'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{t('profileForm.ageHint', { min: MIN_AGE, max: MAX_AGE })}</Text>
      </View>
      <Field
        label={`${t('profileForm.pincode')} *`}
        value={pincode}
        onChangeText={(v) => {
          const digits = asciiDigits(v);
          setPinNote(/\D/.test(digits)); // R136-17: say why a letter / symbol didn't appear
          setPincode(digits.replace(/\D/g, '').slice(0, 6));
          setServerField(null);
        }}
        placeholder={t('profileForm.pincodePlaceholder')}
        keyboardType="number-pad"
        maxLength={6}
        error={errText('pincode')}
        hint={pinNote ? t('profileForm.pincodeDigitsOnly') : undefined}
        inputRef={refs.pincode}
        testID="profile-pincode"
      />
      {pin && !shownErrs.pincode ? (
        <Text style={{ marginTop: -8, marginBottom: 12, fontWeight: '700', color: pin.info !== 'checking' && pin.info.status === 'invalid' ? colors.danger : colors.muted }} testID="profile-pincode-result">
          {pin.info === 'checking'
            ? t('profileForm.pincodeChecking')
            : pin.info.status === 'ok'
              ? t('profileForm.pincodeFound', { district: pin.info.district, state: pin.info.state })
              : pin.info.status === 'invalid'
                ? t('profileForm.pincodeNotFound')
                : t('profileForm.pincodeUnknown') /* R136-16: same words in the demo and on the API */}
        </Text>
      ) : null}
      <Field
        label={t('profileForm.email')}
        value={email ?? ''}
        onChangeText={(v) => (setEmail(v), setServerField(null))}
        placeholder={t('profileForm.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        error={errText('email')}
        inputRef={refs.email}
        testID="profile-email"
      />
      <Text style={ui.label}>{t('profileForm.position')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {POSITIONS.map((p) => (
          <Chip key={p.id} label={positionLabel(p.id, t)} active={position === p.id} onPress={() => setPosition(p.id)} />
        ))}
      </View>
      <Field label={t('profileForm.city')} value={city} onChangeText={setCity} placeholder={t('profileForm.cityPlaceholder')} autoCapitalize="words" maxLength={LIMITS.city.max} testID="profile-city" />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }} testID="profile-error" accessibilityRole="alert">{error}</Text>}
      {ageBlocked && (
        <View style={{ marginVertical: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger }} testID="profile-age-blocked">
          <Text style={{ color: colors.text, fontWeight: '800', marginBottom: 4 }}>{t('profileForm.ageBlockedTitle')}</Text>
          <Text style={{ color: colors.text, marginBottom: 8 }}>{t('profileForm.ageBlocked', { min: MIN_AGE, max: MAX_AGE })}</Text>
          {SUPPORT_EMAIL ? (
            <Button title={t('profileForm.contactSupport')} icon="mail" variant="ghost" onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} testID="profile-contact-support" />
          ) : null}
          <Button title={t('profile.signOut')} icon="log-out" variant="ghost" onPress={() => void signOut()} testID="profile-age-sign-out" />
        </View>
      )}
      <Button title={t('profileForm.save')} icon="checkmark" onPress={save} loading={busy} big />
    </View>
  );
}
