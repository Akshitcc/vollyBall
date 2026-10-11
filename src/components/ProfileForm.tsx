import * as ImagePicker from 'expo-image-picker';
import { LIMITS } from '../core/limits';
import React, { useState } from 'react';
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

export function ProfileForm({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const [name, setName] = useState(profile?.name ?? '');
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
    try {
      fields = checkProfileFields({ name, city });
    } catch (e) {
      return setError(translateError(e));
    }
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
        city: fields.city,
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
      <Field label={t('profileForm.name')} value={name} onChangeText={setName} placeholder={t('profileForm.namePlaceholder')} autoCapitalize="words" maxLength={LIMITS.profileName.max} testID="profile-name" />
      <Text style={ui.label}>{t('profileForm.position')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>
        {POSITIONS.map((p) => (
          <Chip key={p.id} label={positionLabel(p.id, t)} active={position === p.id} onPress={() => setPosition(p.id)} />
        ))}
      </View>
      <Field label={t('profileForm.city')} value={city} onChangeText={setCity} placeholder={t('profileForm.cityPlaceholder')} autoCapitalize="words" maxLength={LIMITS.city.max} testID="profile-city" />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={t('profileForm.save')} icon="checkmark" onPress={save} loading={busy} big />
    </View>
  );
}
