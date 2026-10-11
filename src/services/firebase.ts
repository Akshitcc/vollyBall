import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { initAuth } from './authInit';
import { firebaseConfig } from './config';

let cached: { app: FirebaseApp; auth: Auth; db: Firestore; storage: FirebaseStorage } | null = null;

export function getFirebase() {
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cached = { app, auth: initAuth(app), db: getFirestore(app), storage: getStorage(app) };
  return cached;
}
