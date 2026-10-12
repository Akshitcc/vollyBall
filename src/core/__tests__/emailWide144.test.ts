/**
 * 1.4.4 (QA V143-6, V143-10): the unchanged stored email always passes on save; the email structure checks; and the
 * prepared wider allow list (INACTIVE: core/emailPolicy.ts EMAIL_WIDE_ACTIVE = false) tested through checkEmail(…, true).
 */
import { checkEmail, checkRegistrationUpdate, emailUnchanged, registrationFieldErrors, EMAIL_ALLOWED_RE, EMAIL_ALLOWED_NARROW_RE } from '../registration';
import { EMAIL_WIDE_ACTIVE } from '../emailPolicy';
import { EMAIL_LETTERS } from '../emailChars';
import { EMAIL_LETTERS_WIDE, EMAIL_LETTER_COUNT_WIDE } from '../emailCharsWide';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const code = (v: string, wide?: boolean) => {
  try {
    checkEmail(v, wide);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const stored = (email: string | null) => ({ firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', email, pincode: '110001' });

describe('V143-6: the stored email, unchanged, always passes (API, demo and Firebase all use checkRegistrationUpdate)', () => {
  const legacy = ['张伟@example.com', 'a\u200bb@x.in', 'ab@ex..com', 'a@-x.in', 'ᱚᱞ@x.in'];
  it.each(legacy)('%s: a pincode or name change saves, the address is kept byte for byte', (e) => {
    expect(code(e)).not.toBeNull(); // a new user can't use it
    for (const sent of [{ pincode: '400001' }, { firstName: 'Ashu', email: e }, { email: ` ${e} ` }]) {
      const f = checkRegistrationUpdate(sent, stored(e));
      expect(f.email).toBe(e);
    }
    expect(registrationFieldErrors({ ...stored(e), pincode: '400001' }, stored(e)).email).toBeUndefined();
  });
  it('a changed address gets every check; removing it works; a valid unchanged one is returned folded as before', () => {
    expect(() => checkRegistrationUpdate({ email: '张伟2@example.com' }, stored('张伟@example.com'))).toThrow();
    expect(checkRegistrationUpdate({ email: '' }, stored('张伟@example.com')).email).toBeNull();
    expect(checkRegistrationUpdate({ email: 'Asha@X.in' }, stored('asha@x.in')).email).toBe('asha@x.in');
    expect(checkRegistrationUpdate({ pincode: '400001' }, stored('Asha@X.in')).email).toBe('asha@x.in');
    expect(registrationFieldErrors({ ...stored(null), email: '张伟@example.com' }, stored(null)).email?.code).toBe('email_chars');
  });
  it('emailUnchanged compares like emailKey (case, spaces, NFC) and never matches a missing stored address', () => {
    expect(emailUnchanged('A@X.IN ', 'a@x.in')).toBe(true);
    expect(emailUnchanged('a@x.in', null)).toBe(false);
    expect(emailUnchanged('', 'a@x.in')).toBe(false);
    expect(emailUnchanged('josé@x.in', 'jose\u0301@x.in')).toBe(true);
  });
  it('the other fields are still checked (an unchanged email is no way around them)', () => {
    expect(() => checkRegistrationUpdate({ pincode: 'abc' }, stored('张伟@example.com'))).toThrow();
  });
});

describe('V143-10: structure checks (same as firestore.rules emailPartsOk)', () => {
  it.each([
    ['.a@x.in', 'email_invalid'], ['a.@x.in', 'email_invalid'], ['a..b@x.in', 'email_invalid'], ['a@x..in', 'email_invalid'],
    [`${'a'.repeat(65)}@x.in`, 'email_invalid'], ['a@-x.in', 'email_invalid'], ['a@x-.in', 'email_invalid'], ['a@x.-in', 'email_invalid'],
    ['a@x.in-', 'email_invalid'], ['a@.x.in', 'email_invalid'],
  ])('%s → %s', (e, c) => expect(code(e)).toBe(c));
  it.each(['a.b@x.in', `${'a'.repeat(64)}@x.in`, 'a-@x.in', 'a@x-y.in', 'a@x--y.co.in', 'a-.b@x.in'])('%s is fine', (e) => expect(code(e)).toBeNull());
});

describe('V143-6: the wider list is prepared but INACTIVE in 1.4.4', () => {
  it('the active list is the 1.4.3 one', () => {
    expect(EMAIL_WIDE_ACTIVE).toBe(false);
    expect(EMAIL_ALLOWED_RE).toBe(EMAIL_ALLOWED_NARROW_RE);
    for (const e of ['ᱚᱞ@x.in', 'ꯃꯅ@x.in', 'علی@x.in', 'क्\u200Dष@x.in']) expect(code(e)).not.toBeNull();
  });
  it('wide: Ol Chiki, Meetei Mayek, Urdu/Kashmiri Arabic letters, Extended Arabic-Indic digits', () => {
    for (const e of ['ᱚᱞᱪᱤᱠᱤ@x.in', 'ᱥᱟᱱᱛᱟᱲᱤ᱑᱒@x.in', 'ꯃꯤꯇꯩ@x.in', 'ꯃꯅꯤꯄꯨꯔ꯱@x.in', 'علی@x.in', 'پاکستان۱۲@x.in', 'کٲشُر@x.in', 'a@ھندی.in'])
      expect([e, code(e, true)]).toEqual([e, null]);
  });
  it('wide still refuses: Arabic format/punctuation, tatweel, Arabic-Indic digits, Ol Chiki/Meetei punctuation, other scripts', () => {
    for (const e of ['ع\u0600@x.in', 'عـلی@x.in', 'ع٠@x.in', 'ع،@x.in', 'ᱚ᱾@x.in', 'ꯃ꯫@x.in', '张@x.in', 'ⓐ@x.in', 'a😀@x.in'])
      expect([e, code(e, true)]).not.toEqual([e, null]);
  });
  it('wide: ZWNJ/ZWJ only between two letters of the same Indic script', () => {
    for (const e of ['क्\u200Dष@x.in', 'क्\u200Cष@x.in', 'ক্\u200Cষ@x.in', 'ര്\u200Dമ@x.in', 'a@क्\u200Dष.in', 'क\u200Cख\u200Dग@x.in'])
      expect([e, code(e, true)]).toEqual([e, null]);
    for (const e of ['\u200Dक@x.in', 'क\u200D@x.in', 'a\u200Db@x.in', 'क\u200Dক@x.in', 'क\u200C\u200Dख@x.in', 'ع\u200Cع@x.in', 'ᱚ\u200Dᱞ@x.in', 'क\u200D1@x.in', 'a\u200Bb@x.in'])
      expect([e, code(e, true)]).not.toEqual([e, null]);
  });
  it('the wide list contains the narrow one and no format/control/private-use/unassigned/separator character', () => {
    const narrow = new RegExp(`^[${EMAIL_LETTERS}]$`);
    const wide = new RegExp(`^[${EMAIL_LETTERS_WIDE}]$`);
    let n = 0;
    for (let cp = 0; cp < 0x10000; cp++) {
      const c = String.fromCharCode(cp);
      if (narrow.test(c)) expect(wide.test(c)).toBe(true);
      if (wide.test(c)) {
        n++;
        if (/^[\p{Cf}\p{Cc}\p{Co}\p{Cn}\p{Z}\p{P}\p{S}\p{Lm}]$/u.test(c) && !(cp >= 0x1c78 && cp <= 0x1c7d) && !(cp >= 0xaaf3 && cp <= 0xaaf4) && cp !== 0x0971) // Lm kept on purpose: Devanagari high spacing dot (1.4.3), Ol Chiki mu-ttuddag…, Meetei Mayek repetition marks
          throw new Error(`U+${cp.toString(16)} should not be in the wide list`);
      }
    }
    expect(n).toBe(EMAIL_LETTER_COUNT_WIDE);
  });
});
