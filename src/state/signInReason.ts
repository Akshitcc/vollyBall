/**
 * 1.4.22 (QA V1421-5): when a signed-out user opens a sign-in-only screen (e.g. /ask), the root stack's guard sends
 * them to Login. We remember which screen they wanted so Login can say why ("Sign in to ask VolleyLive …").
 */
let wanted: string | null = null;
const OPEN = new Set(['/', '/login', '/terms', '/terms-view', '/privacy', '/licenses', '/about', '/help', '/contact']);
export function noteSignedOutPath(path: string | null | undefined) {
  if (!path) return;
  const p = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (!OPEN.has(p)) wanted = p;
}
export const signInReasonPath = () => wanted;
export const clearSignInReason = () => { wanted = null; };
/** i18n key for Login's notice, or null when there is nothing to explain. */
export function signInReasonKey(path = wanted): string | null {
  if (!path) return null;
  return path === '/ask' ? 'errors.codes.ask_sign_in' : 'login.signInToContinue';
}
