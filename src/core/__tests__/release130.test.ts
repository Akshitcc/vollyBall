/** 1.3.0: match guards (N121-1..3, baseline holes), B121 core helpers, contrast fixes (N121-4/5/7, B121-6). */
import { CodedError } from '../codedError';
import { MATCH_BAD_STATUS, MATCH_DELETE_FORBIDDEN, MATCH_STATUS_MOVE, MATCH_TERMINAL, SERVER_FIELD, SERVER_TIME, deleteProblem, guardCreate, guardProgress, guardUpdate, stampTimes } from '../matchGuards';
import { MIN_PLAYERS, tournamentCandidates, tournamentTeamsProblem } from '../roster';
import { clampInput } from '../text';
import type { Match } from '../types';
import { colors, contrast, gradients, onColor, overWhite, palette, swatchRing, teamGradient, teamRing, TEAM_HIGHLIGHT_ALPHA } from '../../theme';

const side = (p: string, teamId: string | null = null) => ({ teamId, name: p, color: '#000000', players: ['1', '2', '3', '4', '5', '6'].map((n) => ({ id: `${p}${n}`, name: `${p}${n}` })) });
const base = (over: Partial<Match> = {}): Match =>
  ({ id: 'm1', status: 'live', teamA: side('a'), teamB: side('b'), captains: { A: 'a1', B: 'b1' }, events: [], createdBy: 'a1', scorerId: 'a1', playerOfMatchId: null, startedAt: 1, finishedAt: null, interestedIds: [], ...over }) as unknown as Match;
const cr = (m: unknown, tc: { A?: string | null; B?: string | null }) => guardCreate(m as never, tc);
const code = (f: () => void) => {
  try {
    f();
  } catch (e) {
    return (e as CodedError).code;
  }
  return null;
};

describe('guardCreate (AF-18, N121-2: no create-as-finished)', () => {
  it('only scheduled or live, with no POTM, finish time or server fields', () => {
    expect(code(() => cr(base({ status: 'finished' }), {}))).toBe(MATCH_BAD_STATUS);
    expect(code(() => cr(base({ status: 'abandoned' }), {}))).toBe(MATCH_BAD_STATUS);
    expect(code(() => cr(base({ playerOfMatchId: 'a1' }), {}))).toBe(MATCH_BAD_STATUS);
    expect(code(() => cr(base({ finishedAt: 5 }), {}))).toBe(MATCH_BAD_STATUS);
    expect(code(() => cr({ ...base(), verification: { status: 'approved' } } as never, {}))).toBe(SERVER_FIELD);
    expect(code(() => cr({ ...base(), finishedServerAt: 5 } as never, {}))).toBe(SERVER_FIELD);
    expect(code(() => cr(base(), {}))).toBeNull();
    expect(code(() => cr(base({ status: 'scheduled' }), {}))).toBeNull();
  });
  it('captains: both named, different, on their side; a registered team -> its captain', () => {
    expect(code(() => cr(base({ captains: null } as never), {}))).toBe('captains_required');
    expect(code(() => cr(base({ captains: { A: 'a1', B: 'a1' } } as never), {}))).toBe('captains_same');
    expect(code(() => cr(base({ captains: { A: 'b2', B: 'b1' } } as never), {}))).toBe('captain_not_on_side');
    expect(code(() => cr(base({ teamA: side('a', 'T1') }), { A: 'a2' }))).toBe('captain_not_team_captain');
    expect(code(() => cr(base({ teamA: side('a', 'T1') }), { A: 'a1' }))).toBeNull();
  });
});

describe('guardUpdate / guardProgress (N121-1 terminal one-way, N121-3 server time, INFO PATCH finishedAt)', () => {
  it('client times and server fields are refused', () => {
    expect(code(() => guardUpdate(base(), { finishedAt: Date.now() + 86_400_000 }))).toBe(SERVER_TIME);
    expect(code(() => guardUpdate(base(), { startedAt: 1 }))).toBe(SERVER_TIME);
    expect(code(() => guardUpdate(base(), { verification: { status: 'approved' } } as never))).toBe(SERVER_FIELD);
    expect(code(() => guardUpdate(base(), { playerOfMatchId: 'a1' }))).toBe('potm_use_endpoint');
  });
  it('abandoned and completed (finished + POTM) are terminal: no flip back, no re-stamp, no handover', () => {
    const ab = base({ status: 'abandoned' });
    for (const s of ['live', 'scheduled', 'finished'] as const) expect(code(() => guardUpdate(ab, { status: s }))).toBe(MATCH_TERMINAL);
    expect(code(() => guardProgress(ab, 'live'))).toBe(MATCH_TERMINAL);
    const done = base({ status: 'finished', playerOfMatchId: 'a1', finishedAt: 9 });
    expect(code(() => guardUpdate(done, { status: 'live' }))).toBe(MATCH_TERMINAL);
    expect(code(() => guardUpdate(done, { scorerId: 'b1' }))).toBe(MATCH_TERMINAL);
    expect(code(() => guardProgress(done, 'live'))).toBe(MATCH_TERMINAL);
    // 1.4.3 (QA V142-1/V142-3): a finished match is final – "I want to play" (offered on scheduled matches only)
    // no longer changes it; an abandoned match still takes it
    expect(code(() => guardUpdate(done, { interestedIds: ['x'] }))).toBe('match_finished');
    expect(code(() => guardUpdate({ ...done, status: 'abandoned' } as never, { interestedIds: ['x'] }))).toBeNull();
  });
  it('status moves are one-way except undo while awaiting the POTM; live -> scheduled only before a rally', () => {
    expect(code(() => guardUpdate(base({ status: 'scheduled' }), { status: 'finished' }))).toBe(MATCH_STATUS_MOVE);
    expect(code(() => guardProgress(base({ status: 'finished', finishedAt: 9 }), 'live'))).toBe('match_finished'); // 1.4.2 V141-8: no undo once over
    expect(code(() => guardUpdate(base({ events: [{}] } as never), { status: 'scheduled' }))).toBe(MATCH_STATUS_MOVE);
    expect(code(() => guardUpdate(base(), { status: 'scheduled' }))).toBeNull();
    // 1.4.6 (V145-3): captains are part of the setup lock
    expect(code(() => guardUpdate(base({ events: [{}] } as never), { captains: { A: 'a2', B: 'b1' } } as never))).toBe('match_setup_locked');
  });
});

describe('stampTimes (server time only)', () => {
  it('stamps start on going live, clears it on live -> scheduled, stamps and clears the finish', () => {
    expect(stampTimes({ status: 'scheduled', startedAt: null, finishedAt: null }, 'live', 100)).toEqual({ startedAt: 100, startedServerAt: 100 });
    expect(stampTimes(null, 'live', 7)).toEqual({ startedAt: 7, startedServerAt: 7 });
    expect(stampTimes({ status: 'live', startedAt: 5, finishedAt: null }, 'scheduled', 9)).toEqual({ startedAt: null, startedServerAt: null });
    expect(stampTimes({ status: 'live', startedAt: 5, finishedAt: null }, 'finished', 9)).toEqual({ finishedAt: 9, finishedServerAt: 9 });
    expect(stampTimes({ status: 'finished', startedAt: 5, finishedAt: 9 }, 'live', 10)).toEqual({ finishedAt: null, finishedServerAt: null });
    expect(stampTimes({ status: 'live', startedAt: 5, finishedAt: null }, 'live', 10)).toEqual({}); // never re-stamped
  });
});

describe('deleteProblem (N121-3; 1.4.6 V145-1: core/lifecycle.ts "delete")', () => {
  const dm = (status: Match['status'], over: Partial<Match> = {}) =>
    ({ status, createdBy: 'u', scorerId: 'u', events: [], rules: { bestOf: 1, pointsPerSet: 5 }, firstServe: 'A', teamA: { name: 'A', color: '#000000', players: [{ id: 'u', name: 'U' }] }, teamB: { name: 'B', color: '#000000', players: [{ id: 'v', name: 'V' }] }, participantIds: ['u', 'v'], ...over }) as unknown as Match;
  it('live never; finished never (it had rallies); otherwise the creator or an admin outside the match', () => {
    expect(deleteProblem(dm('live'), 'u', true)).toBe(MATCH_DELETE_FORBIDDEN);
    expect(deleteProblem(dm('finished', { maxEvents: 5 }), 'u', false)).toBe(MATCH_DELETE_FORBIDDEN);
    expect(deleteProblem(dm('finished', { maxEvents: 5 }), 'x', true)).toBe(MATCH_DELETE_FORBIDDEN);
    expect(deleteProblem(dm('scheduled'), 'u', false)).toBeNull();
    expect(deleteProblem(dm('scheduled'), 'x', true)).toBeNull();
    expect(deleteProblem(dm('scheduled'), 'x', false)).toBe(MATCH_DELETE_FORBIDDEN);
    expect(deleteProblem(dm('scheduled'), 'v', true)).toBe(MATCH_DELETE_FORBIDDEN); // an admin who plays in it
    expect(deleteProblem(dm('scheduled', { maxEvents: 3 }), 'u', false)).toBe(MATCH_DELETE_FORBIDDEN); // undone to 0
  });
});

describe('QA B121-2: tournament team picker offers only teams with MIN_PLAYERS', () => {
  const t = (id: string, n: number) => ({ id, memberIds: Array.from({ length: n }, (_, i) => `${id}${i}`) });
  it('filters short teams (and ones already chosen); core refuses them too', () => {
    const r = tournamentCandidates([t('A', 6), t('B', 2), t('C', 12), t('D', 5)], ['C']);
    expect(r.offered.map((x) => x.id)).toEqual(['A']);
    expect(r.tooSmall.map((x) => x.id)).toEqual(['B', 'D']);
    expect(MIN_PLAYERS).toBe(6);
    const all = { A: t('A', 6), B: t('B', 2) } as Record<string, { memberIds: string[] }>;
    expect(tournamentTeamsProblem([{ id: 'A' }, { id: 'B' }], (id) => all[id])).toMatch(/players/i);
  });
});

describe('QA B121-7: clampInput says when a paste was cut', () => {
  it('keeps the first max units, flags the cut, never splits an emoji', () => {
    expect(clampInput('abc', 40)).toEqual({ value: 'abc', cut: false });
    const r = clampInput('x'.repeat(61), 40);
    expect(r.value).toHaveLength(40);
    expect(r.cut).toBe(true);
    const e = clampInput('a'.repeat(39) + '🏐', 40);
    expect(e).toEqual({ value: 'a'.repeat(39), cut: true });
  });
});

describe('contrast (N121-4, N121-5, N121-7, B121-6)', () => {
  it('N121-4: white Team A name on the red gradient >= 4.5:1 at the lightest point', () => {
    const top = overWhite(gradients.teamA[0], TEAM_HIGHLIGHT_ALPHA);
    expect(contrast('#FFFFFF', top)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', gradients.teamA[1])).toBeGreaterThanOrEqual(4.5);
  });
  it('N121-5: muted 12 px text on the hero gradient >= 4.5:1 on every stop', () => {
    for (const stop of gradients.hero) expect(contrast(colors.onInkMuted, stop)).toBeGreaterThanOrEqual(4.5);
  });
  it('N121-7: white on a legacy red (#E53935) custom team and on other customs >= 4.5:1', () => {
    const whiteText = ['#E53935', '#FF6B00', '#1B7F3B', '#00B8F0', '#6A1B9A', '#AD1457'].filter((c) => onColor(c) === colors.white);
    expect(whiteText).toContain('#E53935');
    for (const c of whiteText) {
      const [a, b] = teamGradient(c);
      expect(contrast('#FFFFFF', overWhite(a, TEAM_HIGHLIGHT_ALPHA))).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#FFFFFF', b)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('B121-6: navy Team B gets the ring everywhere (dot, swatch, badge); ordinary colours do not', () => {
    expect(teamRing('#001F4D')).toBe(palette.blueLine);
    expect(swatchRing('#001F4D')).toEqual({ borderWidth: 2, borderColor: palette.blueLine });
    expect(swatchRing('#001F4D', 1.5)!.borderWidth).toBe(1.5);
    expect(contrast(palette.blueLine, colors.ink)).toBeGreaterThanOrEqual(3);
    expect(swatchRing('#D93636')).toBeNull();
    expect(swatchRing('#1B7F3B')).toBeNull();
    expect(teamRing('#D93636')).not.toBeUndefined(); // the score-half ring (next to the navy header) is unchanged
    expect(swatchRing('#FFF5CC')).toEqual({ borderWidth: 2, borderColor: colors.muted }); // faint on white
    expect(swatchRing('nope')).toBeNull();
  });
});
