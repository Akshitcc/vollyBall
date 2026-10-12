/**
 * 1.4.3 core: V142-5 / V142-6 – the email allow list (src/core/emailChars.ts, generated) used by the demo,
 * the Firebase client and the API, tested over every Unicode code point (Node's Unicode data).
 */
import { checkEmail, EMAIL_ALLOWED_RE } from '../registration';
import { EMAIL_LETTERS, EMAIL_LETTER_COUNT } from '../emailChars';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const code = (v: string) => {
  try {
    checkEmail(v);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const ALL: number[] = [];
for (let cp = 0; cp < 0x110000; cp++) if (cp < 0xd800 || cp > 0xdfff) ALL.push(cp);
const letter = new RegExp(`^[${EMAIL_LETTERS}]$`);

describe('V142-6: format, control, private-use, unassigned, separator and default-ignorable characters', () => {
  const BAD = /^[\p{Cf}\p{Cc}\p{Co}\p{Cn}\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]$/u;
  const bad = ALL.filter((cp) => BAD.test(String.fromCodePoint(cp)));
  it('none of them is in the allow list (all ~970k of them)', () => {
    expect(bad.length).toBeGreaterThan(900_000);
    expect(bad.filter((cp) => letter.test(String.fromCodePoint(cp)))).toEqual([]);
  });
  it('every one is refused in the local part, the domain and the TLD (Cf/Cc/Zs/Zl/Zp all; Co/Cn every 997th)', () => {
    const sample = bad.filter((cp, i) => !/^[\p{Co}\p{Cn}]$/u.test(String.fromCodePoint(cp)) || i % 997 === 0);
    expect(sample.length).toBeGreaterThan(1000);
    const passed: string[] = [];
    for (const cp of sample) {
      const c = String.fromCodePoint(cp);
      for (const e of [`ab${c}c@x.in`, `abc@x${c}y.in`, `abc@xy.i${c}n`]) if (code(e) === null) passed.push(`U+${cp.toString(16)} in ${JSON.stringify(e)}`);
    }
    expect(passed).toEqual([]);
  });
  it("Tester's probes: U+FFF9–FFFB, U+0600–0605, U+13430 (format characters) are refused", () => {
    for (const c of ['\uFFF9', '\uFFFA', '\uFFFB', '\u0600', '\u0601', '\u0605', '\u{13430}', '\u{13438}'])
      expect([c, code(`a${c}b@x.in`), code(`ab@x${c}y.in`), code(`ab@xy.i${c}n`)]).toEqual([c, 'email_chars', 'email_chars', 'email_chars']);
  });
});

describe('V142-5: the allow list', () => {
  it('only lower-case/caseless, NFC-stable, already folded characters of the vetted blocks', () => {
    const allowed = ALL.filter((cp) => letter.test(String.fromCodePoint(cp)));
    expect(allowed.length).toBe(EMAIL_LETTER_COUNT);
    for (const cp of allowed) {
      const c = String.fromCodePoint(cp);
      expect([cp.toString(16), /^[\p{Lu}\p{Lt}]$/u.test(c), c.normalize('NFC') === c, c.toLowerCase() === c, /^[\p{L}\p{M}\p{Nd}]$/u.test(c)]).toEqual([cp.toString(16), false, true, true, true]);
      const inBlock = (cp >= 0xc0 && cp <= 0x24f) || (cp >= 0x1e00 && cp <= 0x1eff) || (cp >= 0x370 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff) || (cp >= 0x400 && cp <= 0x52f) || (cp >= 0x900 && cp <= 0xd7f);
      expect([cp.toString(16), inBlock]).toEqual([cp.toString(16), true]);
    }
  });
  it('every capital of every script is folded or refused – none is stored (288 RE2 misses included)', () => {
    const stored: string[] = [];
    for (const cp of ALL) {
      const c = String.fromCodePoint(cp);
      if (!/^[\p{Lu}\p{Lt}]$/u.test(c)) continue;
      try {
        const out = checkEmail(`a${c}b@x.in`);
        if (out && /[\p{Lu}\p{Lt}]/u.test(out)) stored.push(cp.toString(16));
      } catch {
        /* refused */
      }
    }
    expect(stored).toEqual([]);
  });
  it('what is accepted: ASCII atext, Latin/Greek/Cyrillic lower case (capitals folded), Indian scripts', () => {
    for (const e of ["o'brien+tag@x.in", 'a-b_c.d@sub.x-y.in', 'José@X.in', 'ÇAĞRI@x.com.tr', 'ΟΔΟΣ@x.gr', 'Иван@почта.рф', 'राम@उदाहरण.भारत', 'ਪੰਜਾਬ@x.in', 'தமிழ்@x.in', 'ಕನ್ನಡ@x.in', 'മലയാളം@x.in', 'x@xn--p1ai.in'])
      expect([e, code(e)]).toEqual([e, null]);
    expect(checkEmail('José@X.in')).toBe('josé@x.in');
  });
  it('what gets the new message (email_chars): other scripts, symbols, emoji, circled/Roman letters', () => {
    for (const e of ['x@例え.jp', 'محمد@x.in', 'a😀@x.in', 'a℃@x.in', 'ⓐ@x.in', 'ⅰ@x.in', '\u10D0@x.in', 'a\u{10C80}@x.in'])
      expect([e, code(e)]).toEqual([e, 'email_chars']);
    const i18n = require('../../i18n').default;
    expect(i18n.t('errors.codes.email_chars', { lng: 'en' })).toMatch(/character we can’t accept/);
    expect(i18n.t('errors.codes.email_chars', { lng: 'hi' })).toMatch(/अक्षर/);
  });
  it('the generated file is up to date (scripts/gen-email-chars.js)', () => {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '../emailChars.ts');
    const before = fs.readFileSync(file, 'utf8');
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, '../../../scripts/gen-email-chars.js')]);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(EMAIL_ALLOWED_RE.test('a@b.co')).toBe(true);
  });
});
