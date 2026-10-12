import React from 'react';
import { ProfileForm } from '../components/ProfileForm';
import { toProfileAfterSave } from '../services/nav';
import { KeyboardAwareScreen } from '../components/KeyboardAwareScreen';

export default function EditProfile() {
  return (
    <KeyboardAwareScreen edges={[]}>
      <ProfileForm onSaved={toProfileAfterSave} /* 1.4.1 (V140-14): always back on Profile */ />
    </KeyboardAwareScreen>
  );
}
