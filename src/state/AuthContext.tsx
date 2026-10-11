import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { UserProfile } from '../core/types';
import { termsAccepted } from '../core/terms';
import { backend, type AuthUser } from '../services/backend';
import { photoQueue } from '../services/photoQueue';
import { registerForPush } from '../services/notifications';

interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  /** true until we know whether the user is signed in and have loaded the profile and T&C state */
  loading: boolean;
  /** 1.3.0: the signed-in user has accepted the CURRENT T&C version (src/core/terms.ts). */
  termsOk: boolean;
  /** Admin (API: ADMIN_UIDS; Firebase: operator-set custom claim; demo: EXPO_PUBLIC_DEMO_ADMIN_UIDS). */
  isAdmin: boolean;
}
interface AuthApi extends AuthState {
  /** Accept the given T&C version and re-check (the backend validates the version). */
  acceptTerms: (version: string) => Promise<void>;
}

const initial: AuthState = { user: null, profile: null, loading: true, termsOk: false, isAdmin: false };
const Ctx = createContext<AuthApi>({ ...initial, acceptTerms: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initial);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let alive = true;
    const unsub = backend.onAuthChanged((user) => {
      void photoQueue.setUser(user?.uid ?? null); // the photo queue belongs to this account (retest 1.1.0)
      unsubProfile?.();
      unsubProfile = null;
      if (!user) {
        setState({ ...initial, loading: false });
        return;
      }
      setState({ ...initial, user, loading: true });
      // T&C first: the gate comes before registration (1.3.0). A failed read keeps the gate shown.
      let termsKnown = false;
      let profileKnown = false;
      const settle = () => {
        if (termsKnown && profileKnown) setState((s) => (s.user?.uid === user.uid ? { ...s, loading: false } : s));
      };
      void Promise.all([
        backend.getTerms(user.uid).then((t) => termsAccepted(t?.version)).catch(() => false),
        backend.isAdmin(user.uid).catch(() => false),
      ]).then(([termsOk, isAdmin]) => {
        if (!alive) return;
        termsKnown = true;
        setState((s) => (s.user?.uid === user.uid ? { ...s, termsOk, isAdmin } : s));
        settle();
      });
      unsubProfile = backend.watchProfile(user.uid, (profile) => {
        profileKnown = true;
        setState((s) => (s.user?.uid === user.uid ? { ...s, profile } : s));
        settle();
      });
    });
    return () => {
      alive = false;
      unsub();
      unsubProfile?.();
    };
  }, []);

  useEffect(() => {
    if (state.profile?.id && state.termsOk) registerForPush(state.profile.id);
  }, [state.profile?.id, state.termsOk]);

  const acceptTerms = useCallback(
    async (version: string) => {
      const uid = state.user?.uid;
      if (!uid) return;
      await backend.acceptTerms(uid, version);
      const t = await backend.getTerms(uid);
      setState((s) => (s.user?.uid === uid ? { ...s, termsOk: termsAccepted(t?.version) } : s));
    },
    [state.user?.uid],
  );

  return <Ctx.Provider value={{ ...state, acceptTerms }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** For screens rendered only when signed in with a profile. */
export function useMe(): UserProfile {
  const { profile } = useContext(Ctx);
  if (!profile) throw new Error('useMe() used outside a signed-in screen');
  return profile;
}
