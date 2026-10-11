/** 1.3.6 registration validators (names, DOB/age in IST, email, pincode, lookup parsing) and team size. */
import { ageFromDob, ageOn, checkDob, checkEmail, checkPersonName, checkPincode, checkRegistration, demoPincodeLookup, isRealDate, parsePincodeResponse, profileComplete, todayIST } from '../registration';
import { maxPlayersFor, missingPlayers, rosterErrors, sideSizeOk } from '../roster';
import { teamSidePlayers, teamsProblem } from '../newMatchFlow';

// 2026-10-11 10:00 IST
const NOW = Date.parse('2026-10-11T04:30:00Z');
const code = (f: () => unknown) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('names', () => {
  it.each([
    ['Akshit', 'Akshit'],
    ['  akshit   kumar ', 'akshit kumar'],
    ["D'Souza", "D'Souza"],
    ['Jean-Luc', 'Jean-Luc'],
    ['José', 'José'],
    ['अक्षित', 'अक्षित'],
    ['कुमार सिंह', 'कुमार सिंह'],
    ['Al', 'Al'],
  ])('accepts %j', (raw, out) => expect(checkPersonName(raw, 'firstName')).toBe(out));
  it.each([
    ['', 'name_empty'],
    ['    ', 'name_empty'],
    ['\t\n', 'name_empty'],
    ['A', 'name_length'],
    ['a'.repeat(41), 'name_length'],
    ['Rahul1', 'name_chars'],
    ['R@hul', 'name_chars'],
    ["--", 'name_chars'],
    ["'Rahul", 'name_chars'],
    ['Ra--hul', 'name_chars'],
    ['राहुल१', 'name_chars'],
    ['ाराहुल', 'name_chars'],
    ['Rahul😀', 'name_chars'],
    ['A×B', 'name_chars'],
    ['Ra\u200Bhul', 'name_chars'],
  ])('rejects %j (%s)', (raw, c) => expect(code(() => checkPersonName(raw, 'lastName'))).toBe(c));
  it('40 characters is the maximum', () => expect(checkPersonName('a'.repeat(40), 'firstName')).toHaveLength(40));
});

describe('date of birth and age (IST)', () => {
  it('today in IST rolls over at 00:00 IST, not UTC', () => {
    expect(todayIST(Date.parse('2026-10-11T18:29:00Z'))).toBe('2026-10-11');
    expect(todayIST(Date.parse('2026-10-11T18:30:00Z'))).toBe('2026-10-12');
  });
  it('real dates only', () => {
    expect(isRealDate('2024-02-29')).toBe(true);
    expect(isRealDate('2023-02-29')).toBe(false);
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
    expect(isRealDate('11-10-2016')).toBe(false);
  });
  it('leap-day birthdays are reached on 1 March in other years, on 29 Feb in leap years', () => {
    expect(ageOn('2016-02-29', '2027-02-28')).toBe(10);
    expect(ageOn('2016-02-29', '2027-03-01')).toBe(11);
    expect(ageOn('2016-02-29', '2028-02-29')).toBe(12);
    expect(code(() => checkDob('2016-02-29', 10, Date.parse('2026-02-28T06:00:00Z')))).toBe('age_too_young');
    expect(checkDob('2016-02-29', 10, Date.parse('2026-03-01T06:00:00Z'))).toBe('2016-02-29');
  });
  it('today and future dates are refused', () => {
    expect(code(() => checkDob('2026-10-11', 10, NOW))).toBe('dob_future');
    expect(code(() => checkDob('2026-10-12', 10, NOW))).toBe('dob_future');
    expect(code(() => checkDob('2030-01-01', 10, NOW))).toBe('dob_future');
  });
  it('age exactly 10 and exactly 100 are allowed; 9 and 101 are not', () => {
    expect(checkDob('2016-10-11', 10, NOW)).toBe('2016-10-11'); // 10th birthday today
    expect(code(() => checkDob('2016-10-12', 10, NOW))).toBe('age_too_young'); // 10 tomorrow
    expect(checkDob('1926-10-12', 10, NOW)).toBe('1926-10-12'); // 100, 101 tomorrow
    expect(ageFromDob('1926-10-12', NOW)).toBe(99);
    expect(checkDob('1926-10-11', 10, NOW)).toBe('1926-10-11'); // 100 today
    expect(ageFromDob('1926-10-11', NOW)).toBe(100);
    expect(code(() => checkDob('1925-10-11', 10, NOW))).toBe('age_too_old'); // 101
    expect(ageFromDob('1926-10-10', NOW)).toBe(100); // turned 100 yesterday: allowed
    expect(code(() => checkDob('1925-10-10', 10, NOW))).toBe('age_too_old'); // 101 yesterday
  });
  it('the minimum age is configurable', () => {
    expect(code(() => checkDob('2010-01-01', 18, NOW))).toBe('age_too_young');
    expect(checkDob('2008-01-01', 18, NOW)).toBe('2008-01-01');
  });
  it('invalid input', () => {
    for (const v of ['', null, '2024-02-30', 'abc', '1899-12-31']) expect(code(() => checkDob(v, 10, NOW))).toBe('dob_invalid');
  });
});

describe('email (optional)', () => {
  it('empty is fine, a valid address is kept, a bad one is refused', () => {
    expect(checkEmail('')).toBeNull();
    expect(checkEmail('   ')).toBeNull();
    expect(checkEmail(' a.k@example.in ')).toBe('a.k@example.in');
    for (const v of ['a@b', 'a b@c.in', '@x.in', 'x@.in', 'x@y.i', `${'a'.repeat(250)}@x.in`]) expect(code(() => checkEmail(v))).toBe('email_invalid');
  });
});

describe('pincode', () => {
  it('format ^[1-9][0-9]{5}$', () => {
    expect(checkPincode('110001')).toBe('110001');
    expect(checkPincode(' 560001 ')).toBe('560001');
    for (const v of ['000000', '012345', '1100011', '11000', '11000a', '']) expect(code(() => checkPincode(v))).toBe('pincode_invalid');
  });
  it('API responses: found, definitely not found, anything else unknown', () => {
    expect(parsePincodeResponse([{ Message: 'Number of pincode(s) found:21', Status: 'Success', PostOffice: [{ Name: 'Connaught Place', District: 'Central Delhi', State: 'Delhi', Block: 'New Delhi' }] }])).toEqual({ status: 'ok', district: 'Central Delhi', state: 'Delhi', city: 'New Delhi' });
    expect(parsePincodeResponse([{ Message: 'No records found', Status: 'Error', PostOffice: null }])).toEqual({ status: 'invalid' });
    expect(parsePincodeResponse([{ Message: 'Server busy', Status: 'Error', PostOffice: null }])).toEqual({ status: 'unknown' });
    expect(parsePincodeResponse(null)).toEqual({ status: 'unknown' });
    expect(parsePincodeResponse('<html>')).toEqual({ status: 'unknown' });
    expect(parsePincodeResponse([{ Status: 'Success', PostOffice: [] }])).toEqual({ status: 'unknown' });
  });
  it('demo: bundled sample, otherwise format only, never the network', () => {
    expect(demoPincodeLookup('110001')).toEqual({ status: 'ok', district: 'New Delhi', state: 'Delhi' });
    expect(demoPincodeLookup('123456')).toEqual({ status: 'unknown' });
    expect(demoPincodeLookup('012345')).toEqual({ status: 'invalid' });
  });
});

describe('whole registration and completeness', () => {
  const ok = { firstName: 'Akshit', lastName: 'Kumar', dob: '2000-05-20', email: '', pincode: '110001' };
  it('valid → normalised fields', () => expect(checkRegistration(ok, 10, NOW)).toEqual({ ...ok, email: null }));
  it('old profiles (name only) are incomplete', () => {
    expect(profileComplete({}, 10, NOW)).toBe(false);
    expect(profileComplete({ ...ok, pincode: undefined }, 10, NOW)).toBe(false);
    expect(profileComplete(ok, 10, NOW)).toBe(true);
  });
});

describe('team size: Exact 6 vs Custom 6–12', () => {
  const side = (n: number, p = 'a') => ({ players: Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, name: `P${i}` })) });
  it.each([
    [5, false, false],
    [6, true, true],
    [7, false, true],
    [12, false, true],
    [13, false, false],
  ])('%i players: exact %s, custom %s', (n, exact, custom) => {
    expect(sideSizeOk(n, 'exact')).toBe(exact);
    expect(sideSizeOk(n, 'custom')).toBe(custom);
    const errs = (mode: 'exact' | 'custom') => [...rosterErrors(side(n, 'a'), side(6, 'b'), mode), ...missingPlayers(side(n, 'a'), side(6, 'b'))];
    expect(errs('exact').length === 0).toBe(exact);
    expect(errs('custom').length === 0).toBe(custom);
  });
  it('error codes: needPlayers / tooManyExact / tooMany; old matches (no mode) = custom', () => {
    expect(rosterErrors(side(7), side(6, 'b'), 'exact')[0].code).toBe('tooManyExact');
    expect(rosterErrors(side(13), side(6, 'b'), 'custom')[0].code).toBe('tooMany');
    expect(rosterErrors(side(12), side(6, 'b'))).toEqual([]);
    expect(missingPlayers(side(5), side(6, 'b'))[0].code).toBe('needPlayers');
    expect(maxPlayersFor(undefined)).toBe(12);
  });
  it('New match Teams step: limits per mode; a registered team of 8 brings 6 in Exact mode', () => {
    const built = (players: number) => ({ kind: 'build' as const, name: 'X', players, captain: 'c' });
    expect(teamsProblem(built(7), built(6), 'exact')).toEqual({ code: 'tooMany', side: 'A', max: 6 });
    expect(teamsProblem(built(7), built(6), 'custom')).toBeNull();
    expect(teamsProblem(built(12), built(12), 'custom')).toBeNull();
    expect(teamsProblem(built(6), built(13), 'custom')).toEqual({ code: 'tooMany', side: 'B', max: 12 });
    expect(teamsProblem(built(5), built(6), 'custom')).toEqual({ code: 'needPlayers', side: 'A', missing: 1 });
    expect(teamSidePlayers(8, 'exact')).toBe(6);
    expect(teamSidePlayers(8, 'custom')).toBe(8);
    expect(teamSidePlayers(5, 'exact')).toBe(5);
  });
});
