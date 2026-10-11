// Web Firebase Auth init (browser persistence is the default).
import type { FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

export function initAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}
