import * as ImagePicker from 'expo-image-picker';
import { LIMITS } from '../core/limits';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { POSITIONS, type Position, type UserProfile } from '../core/types';
import { backend } from '../services/backend';
import { useAuth } from '../state/AuthContext';
import { positionLabel, translateError } from '../i18n/format';
import { colors } from '../theme';
import { Avatar, Banner, Button, Chip, Field, styles as ui } from './ui';
import { checkProfileFields } from '../core/validate';
import { photoSizeProblem } from '../core/photos';
import { isValidE164 } from '../core/phone';
import { ageFromDob, checkRegistration, fullName, MAX_AGE, PINCODE_RE, type PincodeInfo } from '../core/registration';
import { BACKEND_KIND, MIN_AGE } from '../services/config';
import { DobPicker } from './DobPicker';

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
    let reg: ReturnType<typeof checkRegistration>;
    try {
      reg = checkRegistration({ firstName, lastName, dob, email, pincode }, MIN_AGE);
      if (pin?.pin === reg.pincode && pin.info !== 'checking' && pin.info.status === 'invalid') return setError(t('errors.codes.pincode_unknown'));
      fields = checkProfileFields({ name: fullName(reg.firstName, reg.lastName), city });
    } catch (e) {
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
        // firestore.rules don't know the 1.3.6 fields yet (1.3.7): Firebase builds keep the old shape.
        ...(BACKEND_KIND === 'firebase'
          ? {}
          : { ...reg, district: found?.district ?? null, state: found?.state ?? null }),
        photoURL: photoURL ?? null,
        createdAt: profile?.createdAt ?? Date.now(),
      };
      await backend.saveProfile(p);
      setPhoto(photoURL ?? null);
      onSaved?.();
    } catch (e) {
      setError(translateError(e));
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
      <Field label={`${t('profileForm.firstName')} *`} value={firstName} onChangeText={setFirstName} placeholder={t('profileForm.firstNamePlaceholder')} autoCapitalize="words" maxLength={40} testID="profile-first-name" />
      <Field label={`${t('profileForm.lastName')} *`} value={lastName} onChangeText={setLastName} placeholder={t('profileForm.lastNamePlaceholder')} autoCapitalize="words" maxLength={40} testID="profile-last-name" />
      <DobPicker label={`${t('profileForm.dob')} *`} value={dob} onChange={setDob} minAge={MIN_AGE} testID="profile-dob" />
      <View style={{ marginBottom: 16 }} accessible accessibilityLabel={`${t('profileForm.age')}: ${age != null ? t('profileForm.ageValue', { count: age }) : '–'}`}>
        <Text style={ui.label}>{t('profileForm.age')}</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color: age != null && (age < MIN_AGE || age > MAX_AGE) ? colors.danger : colors.text }} testID="profile-age">
          {age != null ? t('profileForm.ageValue', { count: age }) : '–'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{t('profileForm.ageHint', { min: MIN_AGE, max: MAX_AGE })}</Text>
      </View>
      <Field label={`${t('profileForm.pincode')} *`} value={pincode} onChangeText={(v) => setPincode(v.replace(/\D/g, '').slice(0, 6))} placeholder={t('profileForm.pincodePlaceholder')} keyboardType="number-pad" maxLength={6} testID="profile-pincode" />
      {pin ? (
        <Text style={{ marginTop: -8, marginBottom: 12, fontWeight: '700', color: pin.info !== 'checking' && pin.info.status === 'invalid' ? colors.danger : colors.muted }} testID="profile-pincode-result">
          {pin.info === 'checking'
            ? t('profileForm.pincodeChecking')
            : pin.info.status === 'ok'
              ? t('profileForm.pincodeFound', { district: pin.info.district, state: pin.info.state })
              : pin.info.status === 'invalid'
                ? t('profileForm.pincodeNotFound')
                : t('profileForm.pincodeUnknown')}
        </Text>
      ) : null}
      <Field label={t('profileForm.email')} value={email ?? ''} onChangeText={setEmail} placeholder={t('profileForm.emailPlaceholder')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} maxLength={254} testID="profile-email" />
      <Text style={ui.label}>{t('profileForm.position')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {POSITIONS.map((p) => (
          <Chip key={p.id} label={positionLabel(p.id, t)} active={position === p.id} onPress={() => setPosition(p.id)} />
        ))}
      </View>
      <Field label={t('profileForm.city')} value={city} onChangeText={setCity} placeholder={t('profileForm.cityPlaceholder')} autoCapitalize="words" maxLength={LIMITS.city.max} testID="profile-city" />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }} testID="profile-error" accessibilityRole="alert">{error}</Text>}
      <Button title={t('profileForm.save')} icon="checkmark" onPress={save} loading={busy} big />
    </View>
  );
}
