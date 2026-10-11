import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { RuleSet } from '../../../src/core/rules';
import type { Place } from '../../../src/core/geo';

export type Trx = Knex | Knex.Transaction;

export const newId = () => crypto.randomUUID();
export const toDate = (ms: number | null | undefined): Date | null => (ms === null || ms === undefined ? null : new Date(ms));
export const toMs = (d: Date | null | undefined): number | null => (d ? new Date(d).getTime() : null);
export const nowDate = () => new Date();

/** Order-insensitive set helpers (the Firestore rules compare arrays as sets). */
export const asSet = <T>(xs: readonly T[]) => new Set(xs);
export const setEq = <T>(a: readonly T[], b: readonly T[]) => {
  const A = asSet(a);
  const B = asSet(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
};
export const minus = <T>(a: readonly T[], b: readonly T[]) => {
  const B = asSet(b);
  return [...asSet(a)].filter((x) => !B.has(x));
};

/** Deterministic JSON for "did this field change?" comparisons. */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

/** Keys whose value differs between two documents (like Firestore's diff().affectedKeys()). */
export function changedKeys<T extends object>(before: T, after: T, keys: readonly (keyof T)[]): (keyof T)[] {
  return keys.filter((k) => canonical(before[k]) !== canonical(after[k]));
}

// ---------- rule sets ----------
export async function insertRuleSet(trx: Trx, r: RuleSet): Promise<number> {
  const [id] = await trx('rule_sets').insert({
    preset: r.preset,
    best_of: r.bestOf,
    points_per_set: r.pointsPerSet,
    deciding_set_points: r.decidingSetPoints,
    win_by: r.winBy,
    point_cap: r.pointCap,
    timeouts_per_set: r.timeoutsPerSet,
    side_switch_every: r.sideSwitchEvery,
    deciding_side_switch_every: r.decidingSideSwitchEvery,
    deciding_switch_at: r.decidingSwitchAt,
  });
  return Number(id);
}

export interface RuleSetRow {
  preset: RuleSet['preset'];
  best_of: number;
  points_per_set: number;
  deciding_set_points: number;
  win_by: number;
  point_cap: number | null;
  timeouts_per_set: number;
  side_switch_every: number | null;
  deciding_side_switch_every: number | null;
  deciding_switch_at: number | null;
}

export function ruleSetFromRow(r: RuleSetRow): RuleSet {
  return {
    preset: r.preset,
    bestOf: r.best_of as RuleSet['bestOf'],
    pointsPerSet: r.points_per_set,
    decidingSetPoints: r.deciding_set_points,
    winBy: r.win_by,
    pointCap: r.point_cap,
    timeoutsPerSet: r.timeouts_per_set,
    sideSwitchEvery: r.side_switch_every,
    decidingSideSwitchEvery: r.deciding_side_switch_every,
    decidingSwitchAt: r.deciding_switch_at,
  };
}

export async function loadRuleSets(trx: Trx, ids: number[]): Promise<Map<number, RuleSet>> {
  const rows = ids.length ? await trx('rule_sets').whereIn('id', [...new Set(ids)]) : [];
  return new Map(rows.map((r: RuleSetRow & { id: number }) => [Number(r.id), ruleSetFromRow(r)]));
}

// ---------- places ----------
export const placeCols = (p: Place | null | undefined) => ({
  location_name: p?.name ?? null,
  location_lat: p?.lat ?? null,
  location_lng: p?.lng ?? null,
});
export const placeFromRow = (r: Row): Place | null =>
  r.location_name !== null && r.location_lat !== null && r.location_lng !== null
    ? { name: r.location_name, lat: Number(r.location_lat), lng: Number(r.location_lng) }
    : null;

/** Untyped DB row (knex returns plain objects). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
