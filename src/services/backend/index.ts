import { BACKEND_KIND } from '../config';
import { ApiBackend } from './apiBackend';
import { DemoBackend } from './demoBackend';
import { FirebaseBackend } from './firebaseBackend';
import type { Backend } from './types';

export const backend: Backend = BACKEND_KIND === 'demo' ? new DemoBackend() : BACKEND_KIND === 'api' ? new ApiBackend() : new FirebaseBackend();
export * from './types';
