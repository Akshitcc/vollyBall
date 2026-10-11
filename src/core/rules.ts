/**
 * Volleyball rule sets. Pure TypeScript – no React / Firebase imports.
 */
export type RulePresetId = 'indoor' | 'beach' | 'custom';

export interface RuleSet {
  preset: RulePresetId;
  /** Best of 1, 3 or 5 sets. */
  bestOf: 1 | 3 | 5;
  /** Points needed to win a regular set. */
  pointsPerSet: number;
  /** Points needed to win the deciding (last possible) set. */
  decidingSetPoints: number;
  /** Required lead to win a set (2 in official rules). */
  winBy: number;
  /** Optional hard cap: first to this score wins regardless of lead. null = no cap. */
  pointCap: number | null;
  /** Timeouts allowed per team per set. */
  timeoutsPerSet: number;
  /** Beach: switch sides every N combined points in regular sets. null = never. */
  sideSwitchEvery: number | null;
  /** Beach: switch sides every N combined points in the deciding set. null = never. */
  decidingSideSwitchEvery: number | null;
  /** Indoor: switch sides once when the leading team reaches N in the deciding set. null = never. */
  decidingSwitchAt: number | null;
}

export const INDOOR_RULES: RuleSet = {
  preset: 'indoor',
  bestOf: 5,
  pointsPerSet: 25,
  decidingSetPoints: 15,
  winBy: 2,
  pointCap: null,
  timeoutsPerSet: 2,
  sideSwitchEvery: null,
  decidingSideSwitchEvery: null,
  decidingSwitchAt: 8,
};

export const BEACH_RULES: RuleSet = {
  preset: 'beach',
  bestOf: 3,
  pointsPerSet: 21,
  decidingSetPoints: 15,
  winBy: 2,
  pointCap: null,
  timeoutsPerSet: 1,
  sideSwitchEvery: 7,
  decidingSideSwitchEvery: 5,
  decidingSwitchAt: null,
};

export function presetRules(preset: 'indoor' | 'beach'): RuleSet {
  return preset === 'beach' ? { ...BEACH_RULES } : { ...INDOOR_RULES };
}

/** Merge overrides into a preset; any override marks the rules as custom. */
export function makeRules(base: RuleSet, overrides: Partial<RuleSet> = {}): RuleSet {
  const merged: RuleSet = { ...base, ...overrides };
  const changed = (Object.keys(overrides) as (keyof RuleSet)[]).some(
    (k) => k !== 'preset' && overrides[k] !== base[k],
  );
  if (changed && overrides.preset === undefined) merged.preset = 'custom';
  return validateRules(fitDecidingSwitch(merged, overrides));
}

/**
 * A shorter deciding set keeps its mid-set side switch inside the set: when the deciding-set
 * points drop below the switch point (and the switch point wasn't set explicitly), it moves to the
 * middle (e.g. a set to 3 switches at 2).
 */
export function fitDecidingSwitch(r: RuleSet, overrides: Partial<RuleSet> = {}): RuleSet {
  if (overrides.decidingSwitchAt !== undefined || r.decidingSwitchAt == null || r.decidingSwitchAt <= r.decidingSetPoints) return r;
  return { ...r, decidingSwitchAt: Math.ceil(r.decidingSetPoints / 2) };
}

export function validateRules(r: RuleSet): RuleSet {
  if (![1, 3, 5].includes(r.bestOf)) throw new Error('bestOf must be 1, 3 or 5');
  if (r.pointsPerSet < 1 || r.decidingSetPoints < 1) throw new Error('points per set must be positive');
  if (r.winBy < 1) throw new Error('winBy must be at least 1');
  if (r.pointCap !== null && r.pointCap < r.pointsPerSet) throw new Error('pointCap must be >= pointsPerSet');
  if (r.timeoutsPerSet < 0) throw new Error('timeoutsPerSet cannot be negative');
  // Cross-field checks shared with the API (QA G12) and firestore.rules rulesOk().
  if (r.decidingSwitchAt != null && r.decidingSwitchAt > r.decidingSetPoints) throw new Error('decidingSwitchAt must be <= decidingSetPoints');
  return r;
}

export function setsToWin(r: RuleSet): number {
  return Math.ceil(r.bestOf / 2);
}

export function describeRules(r: RuleSet): string {
  const name = r.preset === 'beach' ? 'Beach' : r.preset === 'indoor' ? 'Indoor' : 'Custom';
  return `${name} · Best of ${r.bestOf} · Sets to ${r.pointsPerSet}${
    r.bestOf > 1 ? `, decider to ${r.decidingSetPoints}` : ''
  } · Win by ${r.winBy}`;
}
