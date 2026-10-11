import React from 'react';
import { ProfileForm } from '../components/ProfileForm';
import { goBackOr } from '../services/nav';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';

export default function EditProfile() {
  return (
    <KeyboardAwareScreen edges={[]}>
      <ProfileForm onSaved={() => goBackOr('/profile')} />
    </KeyboardAwareScreen>
  );
}
