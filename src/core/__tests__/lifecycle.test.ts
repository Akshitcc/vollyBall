/**
 * 1.4.6 (QA V145): the one match lifecycle (core/lifecycle.ts). The table itself, the generated doc, and the core
 * functions every backend calls conforming to it. The per-backend walks: src/services/__tests__/lifecycle146.test.ts
 * (demo), server/tests/lifecycle.test.ts (API), rules-tests "1.4.6: lifecycle walk" (Firebase).
 */
import {
  LC_RULE, LC_STATES, LC_WALK, LC_WALKERS, LIFECYCLE, lcFacts, lcRoles, lifecycleMarkdown, lifecycleProblem, walkExpect, walkFields, type LcMatch,
} from '../lifecycle';
import { ABANDON_POLICIES } from '../abandonPolicy';
import { planAbandon, reportersOf, resolveActions, resolvePatch } from '../abandon';
import { deleteProblem, guardUpdate } from '../matchGuards';
import { confirmProblem, currentVerification, countMatches } from '../antifraud';
import { handoverProblem, reassignProblem, reassignRecord, scorerTargetProblem } from '../scorerHandoff';
import { sideOfPlayer, verdictCaptains } from '../antifraud';
import { presetRules } from '../rules';
import type { Match } from '../types';
import * as fs from 'fs';
import * as path from 'path';

const WR = { ...presetRules('indoor'), bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const CAST = { scorer: 'cap', oppCaptain: 'b0', bPlayer: 'b1', pastAdmin: 'adm2' };
const WHO = { scorer: 'cap', oppCaptain: 'b0', teammate: 'a1', admin: 'adm', stranger: 'zz' } as const;
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id })) });
const mk = (name: string, over: Partial<Match> = {}): Match =>
  ({
    id: 'w', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'A'), teamB: team(B, 'B'), captains: { A: 'cap', B: 'b0' },
    createdBy: 'cap', scorerId: 'cap', participantIds: [...A, ...B], scheduledAt: null, startedAt: 1, finishedAt: null, interestedIds: [], updatedAt: 1,
    ...walkFields(LC_STATES.find((s) => s.name === name)!, CAST, 1_000_000),
    ...over,
  }) as unknown as Match;
const code = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('the table', () => {
  it('has one rule per action, every walked action is in it, every state builds', () => {
    expect(new Set(LIFECYCLE.map((r) => r.action)).size).toBe(LIFECYCLE.length);
    for (const a of LC_WALK) expect(LC_RULE[a]).toBeDefined();
    for (const s of LC_STATES) expect(lcFacts(mk(s.name)).status).toBe(s.status);
  });
  it('docs/LIFECYCLE.md is generated from it (node scripts/gen-lifecycle-doc.js)', () => {
    const doc = fs.readFileSync(path.join(__dirname, '../../../docs/LIFECYCLE.md'), 'utf8');
    expect(doc).toBe(lifecycleMarkdown());
  });
  it('roles: an admin in the match is only a participant; the current scorer is never the verdict captain', () => {
    expect(lcRoles(mk('live3'), 'adm', true).has('admin')).toBe(true);
    expect(lcRoles(mk('live3'), 'a1', true).has('admin')).toBe(false);
    const handed = mk('wonPending', { scorerId: 'b0', scorerReassign: { from: 'cap', to: 'b0', by: 'adm', at: 1 } });
    expect(lcRoles(handed, 'b0', false).has('verdictCaptain')).toBe(false);
    expect(lifecycleProblem('verdict', handed, 'b0', false)).toBe('scoring_side');
  });
  it('the walk has allowed cells for every walker that can act at all', () => {
    const allowed = new Map<string, number>();
    for (const s of LC_STATES) for (const a of LC_WALK) for (const w of LC_WALKERS) if (walkExpect(a, mk(s.name), WHO[w], w === 'admin') === null) allowed.set(w, (allowed.get(w) ?? 0) + 1);
    expect(allowed.get('scorer')).toBeGreaterThan(5);
    expect(allowed.get('admin')).toBeGreaterThan(10);
    expect(allowed.get('oppCaptain')).toBeGreaterThan(1);
    expect(allowed.get('stranger') ?? 0).toBe(0);
  });
});

describe('core conforms (the functions each backend calls)', () => {
  it('every walk cell: planAbandon / reportersOf / resolveActions+resolvePatch / deleteProblem / confirmProblem agree with the table', () => {
    const bad: string[] = [];
    for (const s of LC_STATES) {
      const m = mk(s.name);
      for (const w of LC_WALKERS) {
        const uid = WHO[w];
        const isAdmin = w === 'admin';
        const lc = (a: Parameters<typeof walkExpect>[0]) => walkExpect(a, m, uid, isAdmin) === null;
        const check = (name: string, got: boolean, want: boolean) => got !== want && bad.push(`${s.name} ${name} ${w}: core ${got} table ${want}`);
        check('abandon', code(() => planAbandon(m, uid, Date.now())) === null, lc('abandon'));
        check('report', reportersOf(m).includes(uid), lc('report'));
        check('delete', deleteProblem(m as LcMatch, uid, isAdmin) === null, lc('delete'));
        check('verdict', confirmProblem(m, uid) === null, lc('verdict'));
        for (const [ra, la] of [['confirm_abandon', 'confirmAbandon'], ['reinstate', 'reinstate'], ['reopen', 'reopen'], ['abandon', 'adminAbandon']] as const)
          check(ra, code(() => resolvePatch(m, uid, isAdmin, ra, 5)) === null, lc(la));
        check('editSetup', code(() => guardUpdate(m, { firstServe: 'B' })) === null || w !== 'scorer', lc('editSetup') || w !== 'scorer');
      }
    }
    expect(bad).toEqual([]);
  });
  it('resolveActions is the table for an outside admin', () => {
    for (const s of LC_STATES) {
      const m = mk(s.name);
      const want = (['reinstate', 'confirmAbandon', 'reopen', 'adminAbandon'] as const).filter((a) => lifecycleProblem(a, m, 'adm', true) === null).length;
      expect(resolveActions(m).filter((a) => a !== 'reject_request').length).toBe(want);
    }
  });
});

describe('V145 items in core', () => {
  it('V145-1: delete only at maxEvents 0 without record / re-open, by the creator or an outside admin', () => {
    expect(deleteProblem(mk('sched0'), 'cap', false)).toBeNull();
    expect(deleteProblem(mk('sched0'), 'adm', true)).toBeNull();
    expect(deleteProblem(mk('sched0'), 'a1', true)).toBe('match_delete_forbidden'); // admin in the match
    expect(deleteProblem(mk('undo0', { status: 'scheduled' }), 'cap', false)).toBe('match_delete_forbidden');
    expect(deleteProblem(mk('sched0', { reopenEpoch: 1 }), 'cap', false)).toBe('match_delete_forbidden');
    expect(deleteProblem(mk('wonConfirmed'), 'adm', true)).toBe('match_delete_forbidden');
  });
  it('V145-2: a reopen clears verdict / POTM / confirmed state and starts an epoch; an old-epoch verdict never counts', () => {
    expect(resolveActions(mk('wonConfirmed'))).toEqual([]);
    const p = resolvePatch(mk('nowin3'), 'adm', true, 'reopen', 9);
    expect(p).toMatchObject({ verification: null, confirmedAt: null, playerOfMatchId: null, wasWon: false, reopenEpoch: 1 });
    const stale = mk('wonConfirmed', { reopenEpoch: 1 });
    expect(currentVerification(stale)).toBeNull();
    expect(countMatches([stale]).counted.size).toBe(0);
    expect(currentVerification(mk('wonConfirmed', { reopenEpoch: 1, verification: { status: 'confirmed', captain: 'confirmed', by: 'b0', at: 2, epoch: 1 } }))).not.toBeNull();
  });
  it('V145-3: teams / participants / captains / team size locked after undo to 0', () => {
    const m = mk('undo0');
    expect(code(() => guardUpdate(m, { captains: { A: 'a1', B: 'b0' } }))).toBe('match_setup_locked');
    expect(code(() => guardUpdate(m, { teamSizeMode: 'custom' }))).toBe('match_setup_locked');
    expect(code(() => guardUpdate(m, { teamB: team(B.slice(0, 5), 'B') }))).toBe('match_setup_locked');
    expect(code(() => guardUpdate(mk('live0'), { captains: { A: 'a1', B: 'b0' } }))).toBeNull();
  });
  it('V145-5: after a reinstate the scorer can\'t abandon again; an admin abandon keeps the old record', () => {
    expect(code(() => planAbandon(mk('reinstated'), 'cap', Date.now()))).toBe('abandon_needs_admin');
    const p = resolvePatch(mk('reinstated'), 'adm', true, 'abandon', 9);
    expect(p.abandonHistory).toHaveLength(1);
    expect(p.abandonHistory![0].review).toBe('reinstated');
  });
  it('V145-6: no reassign to the verdict captain; the scorer never confirms', () => {
    expect(reassignProblem(mk('live3'), 'adm', true, 'b0')).toBe('reassign_verdict_captain');
    // 1.4.7 (QA V146-2): nor to anyone on the verdict captain's team; the scorer's own side is fine
    expect(reassignProblem(mk('live3'), 'adm', true, 'b1')).toBe('reassign_verdict_captain');
    expect(reassignProblem(mk('live3'), 'adm', true, 'a1')).toBeNull();
  });
  it('V145-10: reinstate to finished latches wasWon', () => {
    const m = mk('abPending', { events: walkFields({ ...LC_STATES[0], events: 'B5', maxEvents: 5 }, CAST, 1).events, maxEvents: 5 });
    expect(resolvePatch(m, 'adm', true, 'reinstate', 9)).toMatchObject({ status: 'finished', wasWon: true });
  });
  it('V145-11: report only with the record and a rally', () => {
    expect(reportersOf(mk('abPending'))).toEqual(['b0']);
    expect(reportersOf(mk('abLegacy'))).toEqual([]);
    expect(reportersOf(mk('abDirect'))).toEqual([]);
  });
});

// V145-9: the abandon rules under each policy (CI runs the default; scripts/run-policy-suites.sh runs all three)
describe.each(ABANDON_POLICIES.map((p) => [p]))('policy %s', (policy) => {
  it('live3 scorer abandon: review/flag record, consent request (max 3, 2 min apart)', () => {
    const plan = planAbandon(mk('live3'), 'cap', 1_000_000, policy);
    expect(plan.kind).toBe(policy === 'consent' ? 'request' : 'flag');
    const limited = mk('live3', { abandonRequests: 3 });
    expect(code(() => planAbandon(limited, 'cap', 1_000_000, policy))).toBe(policy === 'consent' ? 'abandon_rate_limited' : null);
    const recent = mk('live3', { abandonRequests: 1, abandonRequestAt: 999_000 });
    expect(code(() => planAbandon(recent, 'cap', 1_000_000, policy))).toBe(policy === 'consent' ? 'abandon_rate_limited' : null);
    expect(code(() => planAbandon(recent, 'cap', 999_000 + 120_000, policy))).toBeNull();
  });
  it('no rally: abandoned directly under every policy', () => expect(planAbandon(mk('live0'), 'cap', 1, policy)).toEqual({ kind: 'direct' }));
});

describe('1.4.7 (QA V146-2/3/5)', () => {
  it('V146-3: before the first rally the creator cannot hand scoring to the opposing captain or their team', () => {
    const m = mk('sched0');
    expect(handoverProblem(m, 'b0')).toBe('handover_no_verdict');
    expect(handoverProblem(m, 'b3')).toBe('handover_no_verdict');
    expect(handoverProblem(m, 'a2')).toBeNull();
    expect(reassignProblem(m, 'adm', true, 'b2')).toBe('handover_no_verdict');
  });
  it('V146-2: after the first rally an admin reassigns only off the verdict captain\'s team', () => {
    for (const b of B) expect([b, reassignProblem(mk('live3'), 'adm', true, b)]).toEqual([b, 'reassign_verdict_captain']);
    for (const a of A.slice(1)) expect([a, reassignProblem(mk('live3'), 'adm', true, a)]).toEqual([a, null]);
  });
  it('the verdict invariant holds in every walk state and after every allowed scorer change (walk)', () => {
    const bad: string[] = [];
    const check = (label: string, m: Match) => {
      const caps = verdictCaptains(m);
      if (!caps.length) bad.push(`${label}: no verdict captain`);
      const ss = sideOfPlayer(m, m.scorerId);
      if (caps.includes(m.scorerId) || caps.some((c) => ss !== null && sideOfPlayer(m, c) === ss)) bad.push(`${label}: scorer ${m.scorerId} on the verdict side`);
    };
    const targets = [...A, ...B, 'adm', 'neutral'];
    let n = 0;
    // (1.4.8: the noConfirm* states are older data that breaks it on purpose – only the admin repair fixes those)
    for (const st of LC_STATES.filter((x) => !x.noConfirmer)) {
      const m = mk(st.name, { participantIds: [...A, ...B, 'neutral'] });
      check(st.name, m);
      for (const to of targets) {
        // the creator / scorer's handoff (API: an admin target counts as an admin)
        if (!handoverProblem(m, to, { targetIsAdmin: to === 'adm' }) && (m.status === 'scheduled' || m.status === 'live')) {
          n++;
          check(`${st.name} handover→${to}`, { ...m, scorerId: to, scorerReassign: (m.maxEvents ?? 0) > 0 ? m.scorerReassign ?? null : null } as Match);
        }
        // an admin's reassignment
        if (!reassignProblem(m, 'adm', true, to)) {
          n++;
          const rec = reassignRecord(m, 'adm', to, 1);
          check(`${st.name} reassign→${to}`, { ...m, scorerId: to, ...(rec ? { scorerReassign: rec } : {}) } as Match);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(50);
  });
  it('scorerTargetProblem: nothing to check without captains', () => {
    expect(scorerTargetProblem(mk('live3', { captains: null }), 'b1')).toBeNull();
  });
  it('V146-5: a won (wasWon) abandoned match is reinstated to finished only, never live', () => {
    expect(resolvePatch(mk('abWonLog'), 'adm', true, 'reinstate', 9)).toMatchObject({ status: 'finished', wasWon: true });
    // wasWon set but the log lost its winner: no reinstate at all (it can't go live, and finished needs the winner)
    const m = mk('abWonLog', { events: mk('abPending').events, maxEvents: 5 });
    expect(code(() => resolvePatch(m, 'adm', true, 'reinstate', 9))).toBe('resolve_not_allowed');
  });
});
