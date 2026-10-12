/**
 * 1.4.6 (QA V145): the demo backend walks the one lifecycle (core/lifecycle.ts) – every action in LC_WALK, in every
 * state of LC_STATES, as every walker, is accepted by the demo exactly when the table allows it (the demo has no
 * delete: LC_NOT_ON.demo). Runs under the current ABANDON_POLICY (scripts/run-policy-suites.sh runs all three).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match } from '../../core/types';
import { LC_NOT_ON, LC_STATES, LC_WALK, LC_WALKERS, walkExpect, walkFields, walkSkip, type LcAction } from '../../core/lifecycle';
import { ABANDON_POLICY } from '../../core/abandonPolicy';
import { presetRules } from '../../core/rules';
import { TERMS_VERSION } from '../../core/terms';
import { sideOfPlayer, verdictCaptains } from '../../core/antifraud';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
async function adminBackend() {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  made.push(b);
  const otp = b.sendOtp('+919000000001');
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  const me = (b as unknown as { authUser: { uid: string } }).authUser.uid;
  await b.acceptTerms(me, TERMS_VERSION);
  await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
  return { b, adminUid: me };
}
const WR = { ...presetRules('indoor'), bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id })) });

describe('1.4.6 demo lifecycle walk', () => {
  it('the demo accepts each walk cell exactly when the lifecycle table allows it', async () => {
    const { b, adminUid } = await adminBackend();
    const inner = b as unknown as { db: { matches: Record<string, Match> }; authUser: { uid: string; phone?: string }; terms: Record<string, { version: string; acceptedAt: number }> };
    const WHO = { scorer: 'cap', oppCaptain: 'b0', teammate: 'a1', admin: adminUid, stranger: 'zz' } as const;
    for (const u of ['cap', 'b0', 'a1', 'zz']) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
    const users = (b as unknown as { db: { users: Record<string, Record<string, unknown>> } }).db.users;
    const proto = Object.values(users).find((u) => u.id !== adminUid)!;
    [...A, ...B, 'zz'].forEach((id, i) => (users[id] = { ...proto, id, name: id, phone: `+9190005${String(i).padStart(5, '0')}` }));
    const adminUser = inner.authUser;
    const mk = (spec: (typeof LC_STATES)[number]): Match =>
      ({
        id: 'lw', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' },
        createdBy: 'cap', scorerId: 'cap', participantIds: [...A, ...B], scheduledAt: null, startedAt: spec.status === 'scheduled' ? null : 1, finishedAt: spec.status === 'finished' || spec.status === 'abandoned' ? 2 : null,
        finishedServerAt: spec.status === 'finished' ? 2 : null, interestedIds: [], updatedAt: 1, createdAt: 1,
        ...walkFields(spec, { scorer: 'cap', oppCaptain: 'b0', bPlayer: 'b1', pastAdmin: 'adm2' }, Date.now() - 3_600_000),
      }) as unknown as Match;
    const act = (a: LcAction): Promise<unknown> => {
      switch (a) {
        case 'unschedule': return b.updateMatch('lw', { status: 'scheduled' });
        case 'editSetup': return b.updateMatch('lw', { firstServe: 'B' });
        case 'abandon': return b.abandonMatch('lw');
        case 'report': return b.reportAbandon('lw');
        case 'confirmAbandon': return b.resolveMatch('lw', 'confirm_abandon');
        case 'reinstate': return b.resolveMatch('lw', 'reinstate');
        case 'reopen': return b.resolveMatch('lw', 'reopen');
        case 'adminAbandon': return b.resolveMatch('lw', 'abandon');
        case 'void': return b.reviewMatch('lw', 'void');
        case 'verdict': return b.confirmResult('lw');
        case 'repairVerdict': return b.repairVerdict('lw', { scorerId: 'cap' });
        default: throw new Error(a);
      }
    };
    const bad: string[] = [];
    let n = 0;
    for (const spec of LC_STATES) {
      for (const a of LC_WALK) {
        if (LC_NOT_ON.demo.includes(a) || walkSkip(spec, a)) continue;
        for (const w of LC_WALKERS) {
          const m = mk(spec);
          inner.db.matches.lw = m;
          const uid = WHO[w];
          inner.authUser = w === 'admin' ? adminUser : { uid };
          const want = walkExpect(a, m, uid, w === 'admin', ABANDON_POLICY) === null;
          const got = await act(a).then(() => true, () => false);
          n++;
          if (got !== want) bad.push(`${spec.name} ${a} as ${w}: demo ${got ? 'allows' : 'refuses'}, lifecycle ${want ? 'allows' : walkExpect(a, m, uid, w === 'admin')}`);
        }
      }
    }
    inner.authUser = adminUser;
    expect(bad).toEqual([]);
    expect(n).toBe((LC_STATES.length * (LC_WALK.length - LC_NOT_ON.demo.length) - LC_STATES.filter((x) => walkSkip(x, 'unschedule')).length) * LC_WALKERS.length);
    // 1.4.6 (V145-17): after the first rally the creator is offered the demo admin; a teammate can't ask; the handoff works
    inner.db.matches.lw = mk(LC_STATES.find((x) => x.name === 'live3')!);
    inner.authUser = { uid: 'cap' };
    expect((await b.handoffAdmins('lw')).map((x) => x.id)).toEqual([adminUid]);
    inner.authUser = { uid: 'a1' };
    await expect(b.handoffAdmins('lw')).rejects.toMatchObject({ code: 'forbidden' });
    inner.authUser = { uid: 'cap' };
    await b.updateMatch('lw', { scorerId: adminUid });
    expect(inner.db.matches.lw.scorerId).toBe(adminUid);
    // 1.4.7 (QA V146-2/3): every walk state has a verdict captain, and every scorer change the demo accepts (the
    // creator's handoff, an admin's reassignment) keeps one, never on the scorer's side
    const broken = (m: Match): string | null => {
      const caps = verdictCaptains(m);
      if (!caps.length) return 'no verdict captain';
      const ss = sideOfPlayer(m, m.scorerId);
      return caps.includes(m.scorerId) || caps.some((c) => ss !== null && sideOfPlayer(m, c) === ss) ? `scorer ${m.scorerId} on the verdict side` : null;
    };
    const inv: string[] = [];
    let changes = 0;
    for (const spec of LC_STATES.filter((x) => !x.noConfirmer)) { // (1.4.8: noConfirm* = older data, repaired by an admin)
      const p0 = broken(mk(spec));
      if (p0) inv.push(`${spec.name}: ${p0}`);
      for (const to of ['a1', 'a3', 'b0', 'b1', 'b3', 'zz', adminUid]) {
        for (const how of ['handover', 'reassign'] as const) {
          inner.db.matches.lw = mk(spec);
          inner.authUser = how === 'handover' ? { uid: 'cap' } : adminUser;
          const ok = await (how === 'handover' ? b.updateMatch('lw', { scorerId: to }) : b.reassignScorer('lw', to)).then(() => true, () => false);
          if (!ok) continue;
          changes++;
          const p = broken(inner.db.matches.lw);
          if (p) inv.push(`${spec.name} ${how}→${to}: ${p}`);
        }
      }
    }
    inner.authUser = adminUser;
    expect(inv).toEqual([]);
    expect(changes).toBeGreaterThan(10);
  }, 120000);
});
