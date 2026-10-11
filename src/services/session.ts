/**
 * Sign-out for the whole app (retest 1.1.0 NB-P1): the offline photo queue belongs to the account,
 * so it is cleared before the backend signs out; the next user never uploads the last user's photos.
 */
import { backend } from './backend';
import { photoQueue } from './photoQueue';

export async function signOut(): Promise<void> {
  await photoQueue.clear();
  await backend.signOut();
}
