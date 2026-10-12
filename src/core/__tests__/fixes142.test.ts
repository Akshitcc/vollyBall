/**
 * 1.4.2 core: V141-8 (finished = final score).
 */
import { finishedScoreProblem, guardProgress, MATCH_FINISHED } from '../matchGuards';
import { statusMoveOk } from '../antifraud';
import type { MatchEvent } from '../scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const pt = (side: 'A' | 'B', at: number, playerId?: string): MatchEvent => ({ type: 'point', side, at, ...(playerId ? { playerId } : {}) }) as MatchEvent;
const EV = [pt('A', 1), pt('A', 2), pt('B', 3), pt('A', 4), pt('A', 5)];

describe('V141-8: finishedScoreProblem', () => {
  const fin = { status: 'finished' as const, events: EV };
  it('not finished: no opinion', () => {
    expect(finishedScoreProblem({ status: 'live', events: EV }, EV.slice(0, -1), 'live')).toBeNull();
  });
  it('finished: undo, append, back to live, rewriting history are refused', () => {
    expect(finishedScoreProblem(fin, EV.slice(0, -1), 'live')).toBe(MATCH_FINISHED);
    expect(finishedScoreProblem(fin, EV.slice(0, -1), 'finished')).toBe(MATCH_FINISHED);
    expect(finishedScoreProblem(fin, [...EV, pt('B', 6)], 'finished')).toBe(MATCH_FINISHED);
    expect(finishedScoreProblem(fin, EV, 'live')).toBe(MATCH_FINISHED);
    expect(finishedScoreProblem(fin, [pt('B', 1), ...EV.slice(1)], 'finished')).toBe(MATCH_FINISHED);
    expect(finishedScoreProblem(fin, [...EV.slice(0, -1), pt('B', 5)], 'finished')).toBe(MATCH_FINISHED); // flip the winner
    expect(finishedScoreProblem(fin, [pt('A', 1, 'a1'), ...EV.slice(1)], 'finished')).toBe(MATCH_FINISHED); // credit beyond the last 3
  });
  it('finished: unchanged, or crediting one of the last 3 rallies, is fine', () => {
    expect(finishedScoreProblem(fin, EV, 'finished')).toBeNull();
    expect(finishedScoreProblem(fin, [...EV.slice(0, -1), pt('A', 5, 'a2')], 'finished')).toBeNull();
    expect(finishedScoreProblem(fin, [...EV.slice(0, 2), pt('B', 3, 'b1'), ...EV.slice(3)], 'finished')).toBeNull();
  });
  it('guardProgress / statusMoveOk: finished never goes back to live, POTM or not', () => {
    expect(statusMoveOk({ status: 'finished', playerOfMatchId: null }, 'live')).toBe(false);
    const m = { status: 'finished', events: EV, playerOfMatchId: null } as never;
    expect(() => guardProgress(m, 'live', EV.slice(0, -1))).toThrow(expect.objectContaining({ code: MATCH_FINISHED }));
    expect(() => guardProgress(m, 'finished', EV)).not.toThrow();
  });
});

describe('V141-8: the scoring screen', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/match/[id]/score.tsx'), 'utf8') as string;
  it('Undo is disabled as soon as the match is won (not only after the POTM) and the sheet has no Undo', () => {
    expect(src).toMatch(/const over = st\.finished \|\| match\?\.status === 'finished';/);
    expect(src).toMatch(/const canUndo = ev\.length > 0 && !over( && !paused)?;/); // 1.4.5: also not while an abandon request is pending
    expect(src).toMatch(/if \(!ev\.length \|\| over\) return;/);
    expect(src).not.toMatch(/testID="undo-last"/);
    const i18n = require('../../i18n').default;
    expect(i18n.t('score.undoOver', { lng: 'en' })).toBe('Match over: the score is final');
    expect(i18n.t('score.undoOver', { lng: 'hi' })).toBe('मैच खत्म: स्कोर अब अंतिम है');
  });
});

describe('V141-5 / V141-4 / info: email characters (core, used by the demo, Firebase client and API)', () => {
  const { checkEmail, emailKey, EMAIL_INVISIBLE_RE } = require('../registration');
  const code = (v: string) => {
    try {
      checkEmail(v);
      return null;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };
  it.each(['\u3164', '\u115F', '\u1160', '\uFFA0', '\u034F', '\u2800', '\u200B', '\u200C', '\u2060', '\u206A', '\u202E', '\u2066', '\uFE0F', '\u180B', '\u17B4', '\u{E0041}', '\u{1D173}', '\u{1BCA0}'])(
    'refuses U+%s in the local part, domain and TLD',
    (c) => {
      expect([code(`bo${c}b@x.in`), code(`bob@x${c}.in`), code(`bob@x.i${c}n`)]).toEqual(['email_invalid', 'email_invalid', 'email_invalid']);
    },
  );
  it('EMAIL_INVISIBLE_RE is exactly Default_Ignorable_Code_Point + U+2800 (this Unicode version)', () => {
    const di = /\p{Default_Ignorable_Code_Point}/u;
    const diff: string[] = [];
    for (let c = 0; c < 0x110000; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCodePoint(c);
      if ((di.test(ch) || c === 0x2800) !== EMAIL_INVISIBLE_RE.test(ch)) diff.push(c.toString(16));
    }
    expect(diff).toEqual([]);
  });
  it('capitals of any script are folded by the app (Mtavruli, Cherokee, Ⓐ, Ⅰ) – the rules refuse the unfolded forms', () => {
    expect(emailKey('\u1C90x@x.in')).toBe('\u10D0x@x.in');
    expect(emailKey('\u13A0x@x.in')).toBe('\uAB70x@x.in');
    expect(emailKey('\u24B6x@x.in')).toBe('\u24D0x@x.in');
    expect(emailKey('\u2160x@x.in')).toBe('\u2170x@x.in');
    // 1.4.3 (QA V142-5): these scripts/symbols are outside the email allow list → email_chars (fixes143)
    expect(code('\u1C90x@x.in')).toBe('email_chars');
  });
  it('U+0345 (combining ypogegrammeni) folds to ι; plain addresses are unchanged', () => {
    expect(emailKey('a\u0345b@x.in')).toBe('a\u03B9b@x.in');
    expect(emailKey('a\u03B9b@x.in')).toBe('a\u03B9b@x.in');
    expect(checkEmail('Bob.K@X.in')).toBe('bob.k@x.in');
  });
});

describe('V141-7: scheduledAt (core)', () => {
  const { checkMatchFields, scheduleMsOk, MAX_SCHEDULE_AHEAD_MS } = require('../validate');
  const code = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };
  it('safe integers within the Date range only; a new time at most 2 years ahead; time_invalid before time_in_past', () => {
    expect([1e300, 2 ** 53, 8.64e15 + 1, -1, 1.5, NaN, '1'].map(scheduleMsOk)).toEqual([false, false, false, false, false, false, false]);
    expect(scheduleMsOk(Date.now())).toBe(true);
    const now = Date.now();
    expect(code(() => checkMatchFields({ status: 'scheduled', scheduledAt: 1e300 }, { scheduleChanged: true, now }))).toBe('time_invalid');
    expect(code(() => checkMatchFields({ status: 'scheduled', scheduledAt: -1 }, { scheduleChanged: true, now }))).toBe('time_invalid');
    expect(code(() => checkMatchFields({ status: 'scheduled', scheduledAt: now + MAX_SCHEDULE_AHEAD_MS + 1 }, { scheduleChanged: true, now }))).toBe('time_invalid');
    expect(code(() => checkMatchFields({ scheduledAt: now - 86_400_000 }, { scheduleChanged: true, now, status: 'scheduled' }))).toBe('time_in_past');
    expect(code(() => checkMatchFields({ status: 'scheduled', scheduledAt: now + 365 * 86_400_000 }, { scheduleChanged: true, now }))).toBeNull();
  });
});

describe('info: player stat breakdown; V141-10: Hindi place names', () => {
  const { kindBreakdown } = require('../stats');
  const { placeParts } = require('../placeNamesHi');
  it('only the shot types that occurred; nothing for chip-only (untyped) points', () => {
    expect(kindBreakdown({ playerId: 'a', points: 4, kill: 0, block: 0, ace: 0, tip: 0 })).toBe('');
    expect(kindBreakdown({ playerId: 'a', points: 4, kill: 2, block: 0, ace: 1, tip: 0 })).toBe('2💥 1🎯');
    expect(kindBreakdown(undefined)).toBe('—');
  });
  it('Hindi: Hindi names only, never an English name in a Hindi line; English unchanged', () => {
    expect(placeParts('New Delhi', 'Delhi', 'en')).toEqual(['New Delhi', 'Delhi']);
    expect(placeParts('New Delhi', 'Delhi', 'hi')).toEqual(['नई दिल्ली', 'दिल्ली']);
    expect(placeParts('Mumbai', 'Maharashtra', 'hi')).toEqual(['मुंबई', 'महाराष्ट्र']);
    expect(placeParts('Some Unknown District', 'Tamil Nadu', 'hi')).toEqual(['तमिलनाडु']);
    expect(placeParts('Nowhere', 'Atlantis', 'hi')).toEqual([]);
    expect(placeParts(null, 'Jammu & Kashmir', 'hi')).toEqual(['जम्मू और कश्मीर']);
    expect(placeParts('Chandigarh', 'Chandigarh', 'hi')).toEqual(['चंडीगढ़']);
    for (const [, v] of Object.entries({ a: placeParts('Pune', 'Maharashtra', 'hi') })) expect((v as string[]).join('')).not.toMatch(/[A-Za-z]/);
  });
  it('every state of the demo sample has a Hindi name', () => {
    const { DEMO_PINCODES } = require('../registration');
    for (const { district, state } of Object.values(DEMO_PINCODES) as { district: string; state: string }[]) expect(placeParts(district, state, 'hi')).toHaveLength(2);
  });
});
