import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileForm } from '../components/ProfileForm';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';
import { Button, P } from '../components/ui';
import { signOut } from '../services/session';
import { useAuth } from '../state/AuthContext';

export default function SetupProfile() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  return (
    <KeyboardAwareScreen edges={[]}>
      <P muted style={{ marginBottom: 16 }} testID="setup-intro">{profile ? t('profileForm.completeIntro') : t('profileForm.setupIntro')}</P>
      <ProfileForm />
      {/* A way out if this isn't your number (or after a demo reset). */}
      <Button title={t('profileForm.differentNumber')} icon="log-out" variant="ghost" onPress={() => void signOut()} testID="setup-sign-out" />
    </KeyboardAwareScreen>
  );
}
