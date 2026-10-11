/** Fix re-test (17:29): back fallbacks + toast (#1), en-IN dates (#2), participantIds order (#5). */
import { act, renderHook } from '@testing-library/react-native';
import i18n from '../../i18n';
import { formatDateRangeT, formatDateT, formatWhenT } from '../../i18n/format';
import { canonicalParticipants, orderedParticipants, participantsMatchRoster } from '../../core/roster';
import { backFallback, NO_BACK_ROUTES } from '../nav';
import { hideToast, showToast, useToast } from '../../state/toast';
import { DemoBackend } from '../backend/demoBackend';
import { makeSeed } from '../backend/demoSeed';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { canGoBack: () => false, back: jest.fn(), replace: jest.fn() } }));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('#2 dates use the app formatter (en-IN / hi-IN), never US m/d/y', () => {
  const d = (m: number, day: number, y = 2026) => new Date(y, m - 1, day, 12).getTime();
  test('English', () => {
    expect(formatDateT(d(10, 15))).toBe('15 Oct 2026');
    expect(formatDateRangeT(d(10, 15), d(10, 17))).toBe('15 Oct – 17 Oct 2026');
    expect(formatDateRangeT(d(10, 15), d(10, 15))).toBe('15 Oct 2026');
    expect(formatDateRangeT(d(12, 30), d(1, 2, 2027))).toBe('30 Dec 2026 – 2 Jan 2027');
    expect(formatDateRangeT(d(10, 15))).toBe('15 Oct 2026');
    expect(formatDateRangeT(d(10, 15), d(10, 17))).not.toMatch(/\d+\/\d+\/\d+/);
    expect(formatWhenT(new Date(2026, 9, 15, 18, 30).getTime())).toMatch(/^Thu, 15 Oct, 0?6:30 pm$/i);
  });
  test('Hindi', async () => {
    await i18n.changeLanguage('hi');
    expect(formatDateT(d(10, 15))).toMatch(/^15 अक्[तट]ू॰? 2026$/);
    const r = formatDateRangeT(d(10, 15), d(10, 17));
    expect(r).toMatch(/^15 अक्[तट]ू॰? – 17 अक्[तट]ू॰? 2026$/);
  });
});

describe('#1 deep-linked screens: back arrow fallback and the success toast', () => {
  test('each screen falls back to the tab it belongs to', () => {
    expect(backFallback('team/[id]', { id: 't1' })).toBe('/profile');
    expect(backFallback('challenge/new', { fromTeamId: 'team_smashers' })).toBe('/team/team_smashers');
    expect(backFallback('challenge/new', {})).toBe('/');
    expect(backFallback('tournament/[id]', { id: 'x' })).toBe('/tournaments');
    expect(backFallback('tournament/new')).toBe('/tournaments');
    expect(backFallback('court/new')).toBe('/map');
    expect(backFallback('edit-profile')).toBe('/profile');
    expect(backFallback('match/[id]/index', { id: 'm' })).toBe('/');
    expect(backFallback('match/new')).toBe('/');
    expect([...NO_BACK_ROUTES].sort()).toEqual(['(tabs)', 'login', 'setup-profile', 'terms']);
  });
  test('toast store: shown, replaced, then hidden after its time', async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useToast());
    await act(async () => showToast('one', 1000));
    expect(result.current).toBe('one');
    await act(async () => showToast('two', 1000));
    await act(async () => jest.advanceTimersByTime(800));
    expect(result.current).toBe('two');
    await act(async () => jest.advanceTimersByTime(300));
    expect(result.current).toBeNull();
    await act(async () => showToast('three'));
    await act(async () => hideToast());
    expect(result.current).toBeNull();
    jest.useRealTimers();
  });
  test('the toast text is translated', async () => {
    expect(i18n.t('challenge.sentToast', { team: 'Noida Ninjas' })).toBe('Challenge sent to Noida Ninjas.');
    await i18n.changeLanguage('hi');
    expect(i18n.t('challenge.sentToast', { team: 'Noida Ninjas' })).toBe('Noida Ninjas को चुनौती भेज दी गई।');
  });
});

describe('#5 participantIds: one canonical order (team A, team B, creator/scorer) everywhere', () => {
  const side = (ids: string[]) => ({ players: ids.map((id) => ({ id, name: id, photoURL: null })) });
  const A = side(['a1', 'a2', 'a3']);
  const B = side(['b1', 'b2', 'b3']);
  test('reorders only; an invalid list stays invalid', () => {
    const m = { teamA: A, teamB: B, createdBy: 'c', scorerId: 's', participantIds: ['s', 'b3', 'c', 'b1', 'a2', 'b2', 'a1', 'a3'] };
    expect(canonicalParticipants(m)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c', 's']);
    expect(canonicalParticipants(m)).toEqual(orderedParticipants(A, B, ['c', 's']));
    // nobody is added or dropped
    const missing = { ...m, participantIds: ['b1', 'a1'] };
    expect(canonicalParticipants(missing)).toEqual(['a1', 'b1']);
    expect(participantsMatchRoster({ ...missing, participantIds: canonicalParticipants(missing) })).toBe(false);
    const outsider = { ...m, participantIds: [...m.participantIds, 'zed'] };
    expect(canonicalParticipants(outsider)).toContain('zed');
    expect(participantsMatchRoster({ ...outsider, participantIds: canonicalParticipants(outsider) })).toBe(false);
    // duplicates are left as sent, so the validator still rejects them
    const dup = { ...m, participantIds: ['a1', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3'] };
    expect(canonicalParticipants(dup)).toEqual(dup.participantIds);
  });
  test('demo backend stores the canonical order (B-then-A input)', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    const otp = b.sendOtp('+919000000010');
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    // 1.3.0: every write needs the current T&C accepted (the gate itself is tested in terms130)
    await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
    const m = makeSeed().matches.match_upcoming;
    const ids = (t: typeof m.teamA) => t.players.map((p) => p.id);
    const id = await b.createMatch({ ...m, participantIds: [...ids(m.teamB), ...ids(m.teamA)] } as never);
    const stored = (b as unknown as { db: { matches: Record<string, { participantIds: string[] }> } }).db.matches[id].participantIds;
    expect(stored).toEqual([...ids(m.teamA), ...ids(m.teamB)]);
    await b.updateMatch(id, { participantIds: [...ids(m.teamB).reverse(), ...ids(m.teamA)] });
    expect((b as unknown as { db: { matches: Record<string, { participantIds: string[] }> } }).db.matches[id].participantIds).toEqual([...ids(m.teamA), ...ids(m.teamB)]);
  });
});
