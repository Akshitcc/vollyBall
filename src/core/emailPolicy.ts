/**
 * 1.4.4 (QA V143-6): which email allow list is ACTIVE. Akshit hasn't decided on the wider list yet, so 1.4.4 keeps
 * the 1.4.3 list (false). The wider list (Ol Chiki, Meetei Mayek, Arabic for Urdu/Kashmiri, ZWNJ/ZWJ between
 * letters of one Indic script) is generated and tested (src/core/emailCharsWide.ts, src/core/__tests__/emailWide144.test.ts,
 * rules-tests "V143-6 wide list"). To switch it on (docs/qa/RELEASE-1.4.4.md "Switching on the wider email list"):
 *   1. set EMAIL_WIDE_ACTIVE = true here;
 *   2. node scripts/gen-email-chars.js   (rewrites the generated block of firestore.rules for the wide list);
 *   3. run the app, server and rules suites; deploy the rules together with the app/API release.
 */
export const EMAIL_WIDE_ACTIVE = false;
