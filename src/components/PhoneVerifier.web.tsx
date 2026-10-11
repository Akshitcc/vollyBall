/** Web reCAPTCHA verifier using the Firebase JS SDK's RecaptchaVerifier. */
import * as FirebaseAuth from 'firebase/auth';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import { getFirebase } from '../services/firebase';
import type { PhoneVerifier } from '../services/backend';

export interface PhoneVerifierHandle {
  getVerifier(): PhoneVerifier;
}

// RecaptchaVerifier exists only in the browser build of firebase/auth; the
// TypeScript types resolve to the React Native build, hence the cast.
type RecaptchaCtor = new (auth: unknown, container: string, params: object) => PhoneVerifier;

export const PhoneVerifierHost = forwardRef<PhoneVerifierHandle>(function PhoneVerifierHost(_p, ref) {
  const verifier = useRef<PhoneVerifier | null>(null);
  useImperativeHandle(ref, () => ({
    getVerifier: () => {
      if (!verifier.current) {
        const Ctor = (FirebaseAuth as unknown as { RecaptchaVerifier: RecaptchaCtor }).RecaptchaVerifier;
        verifier.current = new Ctor(getFirebase().auth, 'recaptcha-container', { size: 'invisible' });
      }
      return verifier.current;
    },
  }));
  return <View nativeID="recaptcha-container" />;
});
