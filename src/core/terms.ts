/**
 * Terms & Conditions acceptance (1.3.0). Shared by the app (all three backends), the API server and
 * – as a copied constant – firestore.rules (termsVersion(); rules-tests check they are equal).
 *
 * The T&C text is a DRAFT (i18n `terms.*`, EN + HI, clearly labelled) until the final text is
 * approved; bump TERMS_VERSION whenever the text changes so everyone has to accept again.
 *
 * Acceptance is stored per user (API: terms_acceptances; Firebase: terms/{uid}) and can only be
 * written through the accept action: exactly the current version, with the SERVER's time, for the
 * caller's own uid, never deleted. Until it is accepted every write is refused with
 * TERMS_NOT_ACCEPTED (reads still work, so the app can show the gate).
 */
export const TERMS_VERSION = '2026-10-draft-1';
/** The current text is a draft (the gate shows a DRAFT badge). */
export const TERMS_IS_DRAFT = true;
export const TERMS_NOT_ACCEPTED = 'terms_not_accepted';
export const TERMS_NOT_ACCEPTED_MESSAGE = 'Accept the current Terms & Conditions first';
export const TERMS_VERSION_MISMATCH = 'terms_version_mismatch';

/** True only for the exact current version. */
export const termsAccepted = (version: string | null | undefined): boolean => version === TERMS_VERSION;

export interface TermsAcceptance {
  version: string;
  acceptedAt: number;
}
