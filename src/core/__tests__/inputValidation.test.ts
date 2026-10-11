/**
 * Input-validation build (QA input-validation-audit G7–G17, B2/B3) and the 216 retest (N3, V1):
 * the shared core used by the app, the demo backend, the API server and (by number) firestore.rules.
 * Runs in Asia/Kolkata (jest.globalSetup.js sets TZ for every test), like the users' phones.
 */
import fs from 'fs';
import path from 'path';
import { LIMITS, MAX_EVENTS, MAX_IMAGE_BYTES, MAX_SCORE, MAX_TOURNAMENT_TEAMS } from '../limits';
import { cleanText, textLength, textProblem, TEXT_ERROR_CODES } from '../text';
import { isPastStart, localAt, localDayOffset, PAST_GRACE_MS, tournamentDates } from '../dates';
import { isAllowedPhotoUrl, photoSizeProblem, sniffImageType } from '../photos';
import {
  checkChallengeFields,
  checkChallengeNames,
  checkMatchFields,
  checkProfileFields,
  checkRules,
  checkTeamFields,
  checkTournamentFields,
  ValidationError,
} from '../validate';
import { INDOOR_RULES } from '../rules';
import { isPartialPrefix, sanitizePhoneInput } from '../phone';
import { isLegacyBlue, makeSeed, refreshSeedColours } from '../../services/backend/demoSeed';
import { TEAM_COLORS } from '../types';

const PLACE = { name: 'Court 1', lat: 28.6, lng: 77.2 };
const codeOf = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as ValidationError).code;
  }
  return null;
};

describe('G15/G17 one table of limits', () => {
  test('values', () => {
    expect(LIMITS.sideName.max).toBe(40);
    expect(LIMITS.profileName).toEqual({ min: 2, max: 60 });
    expect(LIMITS.teamName).toEqual({ min: 2, max: 40 });
    expect(LIMITS.tournamentName).toEqual({ min: 3, max: 80 });
    expect(LIMITS.placeName.max).toBe(160);
    expect([MAX_EVENTS, MAX_SCORE, MAX_IMAGE_BYTES, MAX_TOURNAMENT_TEAMS]).toEqual([2000, 199, 10 * 1024 * 1024, 10]);
  });
  test('firestore.rules use the same numbers', () => {
    const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
    expect(rules).toMatch(/nameOk\([^)]*, 2, 60\)/); // profile name
    expect(rules).toMatch(/nameOk\([^)]*, 2, 40\)/); // team name
    expect(rules).toMatch(/nameOk\([^)]*, 3, 80\)/); // tournament name
    expect(rules).toMatch(/nameOk\([^)]*, 2, 80\)/); // court name
    expect(rules).toContain('2000');
    expect(rules).toContain('900000'); // PAST_GRACE_MS
    expect(PAST_GRACE_MS).toBe(900000);
    const storage = fs.readFileSync(path.resolve(__dirname, '../../../storage.rules'), 'utf8');
    expect(storage).toContain('^image/(jpeg|png|webp|heic|gif)$');
    expect(storage).not.toMatch(/matches\('[^']*svg/i); // the allow-list itself has no SVG
    // per-type minimum (MIN_IMAGE_BYTES_BY_TYPE), which is above 0
    expect(storage).toContain('request.resource.size >= minBytes(request.resource.contentType)');
    expect(storage).toMatch(/image\/png' \? 67 : \(t == 'image\/gif' \|\| t == 'image\/webp'\) \? 26 : 100/);
    expect(storage).toContain('request.resource.size < 10 * 1024 * 1024');
  });
});

describe('G14 text helper', () => {
  test('zero-width stripped, NFC, trimmed, UTF-16 length', () => {
    expect(cleanText('  A\u200Bru\u200Dn  ')).toBe('Arun');
    expect(cleanText('e\u0301')).toBe('\u00E9');
    expect(textLength('👍🏽ab')).toBe(6); // UTF-16 units, as the rules' size() (retest 217 #6)
    expect(textProblem('आरव शर्मा', LIMITS.profileName)).toBeNull(); // Hindi allowed
  });
  test('control, bidi, invisible-only and length problems', () => {
    expect(textProblem('ab\u0007c', LIMITS.teamName)).toBe('control');
    expect(textProblem('ab\nc', LIMITS.teamName)).toBe('control');
    expect(textProblem('line1\nline2', LIMITS.challengeMessage, { multiline: true })).toBeNull();
    expect(textProblem('abc\u202Edef', LIMITS.teamName)).toBe('bidi');
    expect(textProblem('\u200B\u200B', LIMITS.teamName)).toBe('empty');
    expect(textProblem('---', LIMITS.teamName)).toBe('empty');
    expect(textProblem('A', LIMITS.teamName)).toBe('tooShort');
    expect(textProblem('x'.repeat(41), LIMITS.teamName)).toBe('tooLong');
    expect(TEXT_ERROR_CODES.tooLong).toBe('text_too_long');
  });
  test('B3: a spaces-only city is stored empty', () => {
    expect(checkProfileFields({ name: ' Aarav ', city: '    ' })).toEqual({ name: 'Aarav', city: '' });
    expect(checkTeamFields({ name: 'Tigers', city: ' \u200B ' }).city).toBe('');
  });
  test('validators throw coded errors with field and limits', () => {
    const e = (() => {
      try {
        checkTeamFields({ name: 'x'.repeat(41) });
      } catch (x) {
        return x as ValidationError;
      }
    })()!;
    expect(e).toBeInstanceOf(ValidationError);
    expect([e.code, e.field, e.max]).toEqual(['text_too_long', 'name', 40]);
  });
});

// The local-day chips (Today / Tomorrow, 00:50 IST, tournament 09:00-18:00) are checked in four
// time zones in datesTz.test.ts (QA retest 217 #8); here only the zone-free parts.
describe('G9 past starts (zone-independent)', () => {
  const late = Date.parse('2026-10-11T15:40:00Z');
  test('grace window', () => {
    expect(isPastStart(late - 10 * 60000, late)).toBe(false); // within 15 min
    expect(isPastStart(late - 16 * 60000, late)).toBe(true);
    expect(PAST_GRACE_MS).toBe(15 * 60000);
  });
  test('challenge / match / tournament reject past starts', () => {
    expect(codeOf(() => checkChallengeFields({ when: late - 60 * 60000, location: PLACE, rules: INDOOR_RULES }, late))).toBe('time_in_past');
    expect(codeOf(() => checkChallengeFields({ when: localAt(1, 6, late), location: PLACE, rules: INDOOR_RULES }, late))).toBeNull();
    expect(codeOf(() => checkMatchFields({ status: 'scheduled', scheduledAt: late - DAY }, { now: late, scheduleChanged: true }))).toBe('time_in_past');
    expect(codeOf(() => checkMatchFields({ status: 'scheduled', scheduledAt: late - DAY }, { now: late, scheduleChanged: false }))).toBeNull();
  });
  test('tournament never ends before it starts', () => {
    const l = tournamentDates(0, 1, late);
    expect(l.endDate).toBeGreaterThanOrEqual(l.startDate);
    expect(localDayOffset(tournamentDates(7, 3, late).endDate, late)).toBe(9);
  });
});
const DAY = 86400000;

describe('G8/G12/G13 structure', () => {
  test('G8 tournaments: end ≥ start, ≥ 2 teams, no duplicates', () => {
    const base = { name: 'Monsoon Cup', startDate: 2e12, endDate: 2e12 + DAY, teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    expect(codeOf(() => checkTournamentFields(base))).toBeNull();
    expect(codeOf(() => checkTournamentFields({ ...base, endDate: base.startDate - 1 }))).toBe('end_before_start');
    expect(codeOf(() => checkTournamentFields({ ...base, teams: [base.teams[0]] }))).toBe('need_two_teams');
    expect(codeOf(() => checkTournamentFields({ ...base, teams: [base.teams[0], base.teams[0]] }))).toBe('duplicate_teams');
  });
  test('G12 rules ranges', () => {
    expect(() => checkRules(INDOOR_RULES)).not.toThrow();
    expect(codeOf(() => checkRules({ ...INDOOR_RULES, pointsPerSet: 0 }))).toBe('rules_invalid');
    expect(codeOf(() => checkRules({ ...INDOOR_RULES, pointsPerSet: 1000 }))).toBe('rules_invalid');
    expect(codeOf(() => checkRules({ ...INDOOR_RULES, bestOf: 4 as never }))).toBe('rules_invalid');
  });
  test('G13 finish ≥ start', () => {
    expect(codeOf(() => checkMatchFields({ startedAt: 2000, finishedAt: 1000 }))).toBe('end_before_start');
    expect(codeOf(() => checkMatchFields({ startedAt: 1000, finishedAt: 2000 }))).toBeNull();
  });
  test('G19 challenge names must be the team documents’ names', () => {
    expect(codeOf(() => checkChallengeNames({ fromTeamName: 'Fake', toTeamName: 'B' }, { name: 'A' }, { name: 'B' }))).toBe('team_name_mismatch');
    expect(codeOf(() => checkChallengeNames({ fromTeamName: 'A', toTeamName: 'B' }, { name: 'A' }, { name: 'B' }))).toBeNull();
  });
});

describe('G3/G10/G11 photos', () => {
  test('size', () => {
    expect(photoSizeProblem(0)).toBe('empty');
    expect(photoSizeProblem(MAX_IMAGE_BYTES)).toBe('tooLarge');
    expect(photoSizeProblem(500_000)).toBeNull();
    expect(photoSizeProblem(undefined)).toBeNull();
  });
  test('magic bytes', () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode('<html><script>'))).toBeNull();
  });
  test('URLs: project storage host or the API /files path only', () => {
    const bucket = 'volleylive.appspot.com';
    expect(isAllowedPhotoUrl(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/avatars%2Fu1%2Fa.jpg?alt=media`, { bucket })).toBe(true);
    expect(isAllowedPhotoUrl('https://evil.example/a.jpg', { bucket })).toBe(false);
    expect(isAllowedPhotoUrl('javascript:alert(1)', { bucket })).toBe(false);
    expect(isAllowedPhotoUrl(`https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/avatars%2Fa.jpg`, { bucket })).toBe(false);
    expect(isAllowedPhotoUrl('http://10.0.2.2:4000/files/avatars/u1/a.jpg', { apiBase: 'http://10.0.2.2:4000' })).toBe(true);
    expect(isAllowedPhotoUrl('http://10.0.2.2:4000/other/a.jpg', { apiBase: 'http://10.0.2.2:4000' })).toBe(false);
  });
});

describe('N3 partial country code while typing', () => {
  test.each(['+', '+9', '+91', '+91 ', '00', '0091'])('%p is a partial prefix', (s) => expect(isPartialPrefix(s)).toBe(true));
  test.each(['+1', '+44', '9', 'abc', '+919'])('%p is not', (s) => expect(isPartialPrefix(s)).toBe(false));
  test('completes normally', () => {
    expect(sanitizePhoneInput('+919')).toBe('9');
    expect(sanitizePhoneInput('+91 98765 43210')).toBe('9876543210');
    expect(sanitizePhoneInput('+91 (98765) 43210')).toBe('9876543210'); // N1 paste
  });
});

describe('V1 no blue team colours', () => {
  test('presets and the demo seed have no blue', () => {
    expect(TEAM_COLORS.filter(isLegacyBlue)).toEqual([]);
    const seed = makeSeed(2e12);
    const colours = [
      ...Object.values(seed.teams).map((t) => t.color),
      ...Object.values(seed.matches).flatMap((m) => [m.teamA.color, m.teamB.color]),
      ...Object.values(seed.tournaments).flatMap((t) => t.teams.map((x) => x.color)),
    ];
    expect(colours.filter(isLegacyBlue)).toEqual([]);
  });
  test('isLegacyBlue', () => {
    for (const c of ['#1565C0', '#2563EB', '#1E88E5', '#1D4ED8', '#3B5BDB']) expect(isLegacyBlue(c)).toBe(true);
    for (const c of ['#2B2B2B', '#E53935', '#FF6B00', '#1B7F3B', '#6A1B9A', '#00695C', '#111111', '#001F4D', '#002E6E']) expect(isLegacyBlue(c)).toBe(false);
  });
  test('a demo DB saved by an older build gets the seed colours back; user colours stay', () => {
    const seed = makeSeed(2e12);
    const stored = JSON.parse(JSON.stringify(seed));
    const [blueId] = Object.keys(stored.teams);
    const [otherId] = Object.keys(stored.teams).slice(1);
    stored.teams[blueId].color = '#1E88E5';
    stored.teams[otherId].color = '#AD1457'; // user recoloured: kept
    const matchId = Object.keys(stored.matches)[0];
    stored.matches[matchId].teamB.color = '#1565C0';
    stored.teams.mine = { ...stored.teams[blueId], id: 'mine', color: '#1565C0' }; // user's own team: kept
    const out = refreshSeedColours(stored, seed);
    expect(out.teams[blueId].color).toBe(seed.teams[blueId].color);
    expect(out.teams[otherId].color).toBe('#AD1457');
    expect(out.matches[matchId].teamB.color).toBe(seed.matches[matchId].teamB.color);
    expect(out.teams.mine.color).toBe('#1565C0');
  });
});
