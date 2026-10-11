import {
  devanagariToAscii,
  E164_IN_RE,
  isValidE164,
  isValidMobile,
  normalizePhone,
  sanitizePhoneInput,
  toE164,
} from '../phone';

describe('normalizePhone: accepted forms → +91 E.164', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['098765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
    ['98765.43210', '+919876543210'],
    ['  98765 43210  ', '+919876543210'],
    ['6000000000', '+916000000000'],
    // 91 is only a prefix when 10 digits remain: this is a 10-digit number starting with 9
    ['9198765432', '+919198765432'],
    // Hindi keyboard digits are converted (G18)
    ['९८७६५४३२१०', '+919876543210'],
    ['+९१ ९८७६५-४३२१०', '+919876543210'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));
});

describe('normalizePhone: rejected (G5 / Team Lead root cause)', () => {
  it.each([
    ['empty', ''],
    ['too short (9 digits)', '987654321'],
    ['too long (11 digits)', '98765432101'],
    ['far too long', '99999999999999999999'],
    ['+91 then 9 digits', '+91987654321'],
    ['+91 then 11 digits', '+9198765432101'],
    ['+91 then 13 digits', '+919876543210123'],
    ['starts with 5', '5876543210'],
    ['+91 then starts with 5', '+915876543210'],
    ['starts with 0 after +91', '+910876543210'],
    ['starts with 1', '1234567890'],
    ['+1 (US)', '+1 4155552671'],
    ['+44 (UK)', '+447911123456'],
    ['+12345678 (old 8-15 digit rule)', '+12345678'],
    ['+00000000', '+00000000'],
    ['00 + other country', '0044 7911 123456'],
    ['letters inside (not stripped)', '98765abc43210'],
    ['pasted text with letters', 'Call me: 98765 43210'],
    ['only letters', 'abc'],
    ['emoji', '98765😀43210'],
    ['full-width digits', '９８７６５４３２１０'],
    ['Bengali digits', '৯৮৭৬৫৪৩২১০'],
    ['Arabic-Indic digits', '٩٨٧٦٥٤٣٢١٠'],
    ['+ in the middle', '98765+43210'],
    ['91 with 5 after it', '91 5876543210'],
  ])('%s: %s', (_label, input) => expect(normalizePhone(input)).toBeNull());
});

describe('sanitizePhoneInput (what the input field keeps)', () => {
  it('keeps partial digits while typing', () => {
    expect(sanitizePhoneInput('9')).toBe('9');
    expect(sanitizePhoneInput('98765')).toBe('98765');
    expect(sanitizePhoneInput('')).toBe('');
  });
  it('strips only spaces, dashes, dots, brackets and the +91 / 0091 / 91 / 0 prefix', () => {
    expect(sanitizePhoneInput('+91 98765-43210')).toBe('9876543210');
    expect(sanitizePhoneInput('(987) 654.3210')).toBe('9876543210');
    expect(sanitizePhoneInput('0987')).toBe('987');
  });
  it('refuses (null) anything that would need guessing', () => {
    for (const bad of ['98765abc43210', 'a', '98765432101', '+1 650', '+44', '９', '98765😀', '#*'])
      expect(sanitizePhoneInput(bad)).toBeNull();
  });
  it('never returns more than 10 digits', () => {
    for (const s of ['919876543210', '00919876543210', '+919876543210', '09876543210']) expect(sanitizePhoneInput(s)).toHaveLength(10);
  });
});

describe('validators', () => {
  it('isValidMobile is exactly ^[6-9]\\d{9}$ on ASCII digits', () => {
    expect(isValidMobile('9876543210')).toBe(true);
    expect(isValidMobile('5876543210')).toBe(false);
    expect(isValidMobile('987654321')).toBe(false);
    expect(isValidMobile('98765432101')).toBe(false);
    expect(isValidMobile('९८७६५४३२१०')).toBe(false); // must be converted first
  });
  it('isValidE164 / E164_IN_RE is ^\\+91[6-9]\\d{9}$', () => {
    expect(isValidE164('+919876543210')).toBe(true);
    for (const bad of ['919876543210', '+91987654321', '+9198765432101', '+915876543210', '+16505551234', '+91 9876543210', 42, null])
      expect(isValidE164(bad)).toBe(false);
    expect(E164_IN_RE.source).toBe('^\\+91[6-9]\\d{9}$');
  });
  it('toE164 only for valid national numbers', () => {
    expect(toE164('9876543210')).toBe('+919876543210');
    expect(toE164('5876543210')).toBeNull();
  });
  it('devanagariToAscii maps ०-९ only', () => {
    expect(devanagariToAscii('०१२३४५६७८९')).toBe('0123456789');
    expect(devanagariToAscii('９')).toBe('９');
  });
});
