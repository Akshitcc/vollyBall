/**
 * 1.4.1 tester findings (core): V140-7 daily rotation (deleting / turning off never reshapes started cycles,
 * today's fact stable, bounded gaps, phone clock skew), V140-4 (case folding), V140-6 (no upper case left),
 * V140-10 (demo match field types).
 */
import { DAILY_EPOCH_DAY, dailySlot, istDayNumber, istDayStart, pickDaily, type DailyItem } from '../dailyItems';
import { checkEmail, emailFold, emailKey } from '../registration';

const DAY = 86_400_000;
const dayStart = (d: number) => Date.parse(`${new Date(d * DAY).toISOString().slice(0, 10)}T00:00:00+05:30`);
/** tiny deterministic PRNG (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ev = { at: number; kind: 'add' | 'off' | 'del' | 'on'; id: string; newId?: string };
/** The item list (as a backend stores it) after applying every event up to `t`. */
function stateAt(events: readonly Ev[], seedItems: readonly DailyItem[], t: number): DailyItem[] {
  const m = new Map<string, DailyItem>(seedItems.map((i) => [i.id, { ...i }]));
  for (const e of events) {
    if (e.at > t) break;
    const x = m.get(e.id);
    if (e.kind === 'add') m.set(e.id, { id: e.id, type: 'fact', textEn: e.id, textHi: e.id, active: true, createdAt: e.at, removedAt: null });
    else if (e.kind === 'off' && x?.active) m.set(e.id, { ...x, active: false, removedAt: e.at });
    else if (e.kind === 'del' && x && !x.deleted) m.set(e.id, { ...x, active: false, deleted: true, removedAt: x.active ? e.at : x.removedAt ?? e.at });
    else if (e.kind === 'on' && x && !x.active && !x.deleted) {
      m.set(e.id, { ...x, deleted: true });
      m.set(e.newId!, { ...x, id: e.newId!, active: true, deleted: false, createdAt: e.at, removedAt: null });
    }
  }
  return [...m.values()];
}

/** Random admin activity over `days` days from `from` (IST day numbers), `n0` items at the start. */
function simulate(seed: number, from: number, days: number, n0: number, rate: { add: number; off: number; del: number; on: number }) {
  const r = rng(seed);
  const seedItems: DailyItem[] = Array.from({ length: n0 }, (_, i) => ({ id: `s${String(i).padStart(3, '0')}`, type: 'fact', textEn: 's', textHi: 's', active: true, createdAt: dayStart(DAILY_EPOCH_DAY) - (i + 1) * 1000, removedAt: null }));
  const events: Ev[] = [];
  let k = 0;
  const live = new Set(seedItems.map((i) => i.id));
  const off = new Set<string>();
  for (let d = from; d < from + days; d++) {
    const base = dayStart(d);
    const pick = (set: Set<string>) => [...set][Math.floor(r() * set.size)];
    const evs: Ev[] = [];
    if (r() < rate.add) evs.push({ at: base + 1 + Math.floor(r() * (DAY - 2)), kind: 'add', id: `a${k++}` });
    if (r() < rate.off && live.size > 3) evs.push({ at: base + 1 + Math.floor(r() * (DAY - 2)), kind: 'off', id: pick(live) });
    if (r() < rate.del && live.size + off.size > 3) evs.push({ at: base + 1 + Math.floor(r() * (DAY - 2)), kind: 'del', id: pick(r() < 0.7 || !off.size ? live : off) });
    if (r() < rate.on && off.size) evs.push({ at: base + 1 + Math.floor(r() * (DAY - 2)), kind: 'on', id: pick(off), newId: `c${k++}` });
    evs.sort((a, b) => a.at - b.at);
    for (const e of evs) {
      if (e.kind === 'add') live.add(e.id);
      if (e.kind === 'off' && live.delete(e.id)) off.add(e.id);
      if (e.kind === 'del') {
        live.delete(e.id);
        off.delete(e.id);
      }
      if (e.kind === 'on' && off.delete(e.id)) live.add(e.newId!);
      events.push(e);
    }
  }
  return { events, seedItems };
}

describe('V140-7: the rotation with deletions and items turned off / back on', () => {
  const FROM = DAILY_EPOCH_DAY + 3;
  const scenarios = [
    { seed: 1, n0: 60, rate: { add: 0.3, off: 0.15, del: 0.15, on: 0.1 } },
    { seed: 2, n0: 90, rate: { add: 0.5, off: 0.3, del: 0.3, on: 0.2 } },
    { seed: 3, n0: 8, rate: { add: 0.2, off: 0.1, del: 0.1, on: 0.05 } },
    { seed: 4, n0: 30, rate: { add: 0.05, off: 0.4, del: 0.4, on: 0.3 } },
  ];

  it.each(scenarios)('removing or turning off an item never changes today’s fact unless it IS today’s (seed $seed)', ({ seed, n0, rate }) => {
    const { events, seedItems } = simulate(seed, FROM, 250, n0, rate);
    let checked = 0;
    let todays = 0;
    for (const e of events) {
      if (e.kind === 'add' || e.kind === 'on') {
        // adding (or a copy turned back on) never changes today
        const before = pickDaily(stateAt(events, seedItems, e.at - 1), e.at);
        const after = pickDaily(stateAt(events, seedItems, e.at), e.at);
        expect(after?.id).toBe(before?.id);
        continue;
      }
      const before = pickDaily(stateAt(events, seedItems, e.at - 1), e.at);
      const after = pickDaily(stateAt(events, seedItems, e.at), e.at);
      checked++;
      if (before?.id === e.id) {
        todays++;
        expect(after?.id).not.toBe(e.id); // hidden at once
        expect(after?.active).toBe(true);
      } else expect(after?.id).toBe(before?.id);
      // …and every later day of the cycles already started stays as it was, except the removed item's own slot
      const cyc = dailySlot(stateAt(events, seedItems, e.at - 1), istDayNumber(e.at));
      for (let d = istDayNumber(e.at) + 1; cyc && d < Math.min(cyc.start + cyc.length, istDayNumber(e.at) + 8); d++) {
        const b = dailySlot(stateAt(events, seedItems, e.at - 1), d);
        const a = dailySlot(stateAt(events, seedItems, e.at), d);
        expect([a?.start, a?.length]).toEqual([b?.start, b?.length]); // same cycle
        if (b?.item.id !== e.id) expect(a?.item.id).toBe(b?.item.id);
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(todays).toBeLessThan(checked); // sanity: most removals are not today's fact
  });

  it.each(scenarios)('bounded gaps: an item that stays on is shown again within 2 × (most items ever on) days; a new item within that many (seed $seed)', ({ seed, n0, rate }) => {
    const DAYS = 700;
    const { events, seedItems } = simulate(seed, FROM, DAYS, n0, rate);
    const shown: string[] = [];
    let maxOn = n0;
    for (let d = FROM; d < FROM + DAYS; d++) {
      const st = stateAt(events, seedItems, dayStart(d)); // as the phone sees it at the start of the day
      maxOn = Math.max(maxOn, st.filter((i) => i.active).length);
      shown.push(pickDaily(st, dayStart(d) + 1)!.id);
    }
    const final = stateAt(events, seedItems, dayStart(FROM + DAYS));
    const lastIndex = new Map<string, number>();
    let worst = 0;
    for (let i = 0; i < shown.length; i++) {
      const id = shown[i];
      const prev = lastIndex.get(id);
      if (prev != null) worst = Math.max(worst, i - prev);
      lastIndex.set(id, i);
    }
    // items on for the whole period: never unseen longer than the bound (also at the end of the window)
    const bound = 2 * maxOn;
    for (const it0 of final.filter((i) => i.active && (i.createdAt ?? 0) < dayStart(FROM))) {
      const idx = shown.map((x, i) => (x === it0.id ? i : -1)).filter((i) => i >= 0);
      expect(idx.length).toBeGreaterThan(0);
      expect(idx[0]).toBeLessThanOrEqual(bound);
      for (let j = 1; j < idx.length; j++) expect(idx[j] - idx[j - 1]).toBeLessThanOrEqual(bound);
      expect(shown.length - 1 - idx[idx.length - 1]).toBeLessThanOrEqual(bound);
    }
    expect(worst).toBeLessThanOrEqual(bound);
    // a new item still on DAYS later: first shown within `bound` days of being added
    for (const e of events.filter((x) => x.kind === 'add')) {
      const d = istDayNumber(e.at) - FROM;
      if (d + bound >= DAYS) continue;
      const stillOn = stateAt(events, seedItems, dayStart(FROM + d + bound + 1)).find((i) => i.id === e.id)?.active;
      if (!stillOn) continue;
      const first = shown.indexOf(e.id, d + 1);
      expect(first).toBeGreaterThan(d);
      expect(first - d).toBeLessThanOrEqual(bound);
    }
  });

  it('no deletions: still exactly once per cycle, gap = next cycle length (≤ n)', () => {
    const { events, seedItems } = simulate(7, FROM, 300, 40, { add: 0.2, off: 0, del: 0, on: 0 });
    const shown: string[] = [];
    for (let d = FROM; d < FROM + 300; d++) shown.push(pickDaily(stateAt(events, seedItems, dayStart(d)), dayStart(d) + 1)!.id);
    const final = stateAt(events, seedItems, dayStart(FROM + 300));
    const last = new Map<string, number>();
    for (let i = 0; i < shown.length; i++) {
      const p = last.get(shown[i]);
      if (p != null) expect(i - p).toBeLessThanOrEqual(final.length);
      last.set(shown[i], i);
    }
  });

  it('phone clock skew: a fact added 30 s ago (server time) with the phone 60 s behind changes nothing', () => {
    const { events, seedItems } = simulate(11, FROM, 200, 50, { add: 0.4, off: 0.1, del: 0.1, on: 0.05 });
    for (const e of events.filter((x) => x.kind === 'add')) {
      const items = stateAt(events, seedItems, e.at);
      const serverNow = e.at + 30_000;
      if (istDayNumber(serverNow - 90_000) !== istDayNumber(serverNow)) continue; // not across midnight
      const before = pickDaily(stateAt(events, seedItems, e.at - 1), serverNow);
      expect(pickDaily(items, serverNow - 60_000)?.id).toBe(before?.id); // phone behind
      expect(pickDaily(items, serverNow + 60_000)?.id).toBe(before?.id); // phone ahead
    }
  });

  it('an item removed the same day it was added never takes a slot; tombstones alone show nothing', () => {
    const t = dayStart(FROM) + 3600_000;
    const it0: DailyItem = { id: 'x', type: 'fact', textEn: 'x', textHi: 'x', active: false, createdAt: t, removedAt: t + 1000 };
    expect(pickDaily([it0], t + 5 * DAY)).toBeNull();
    const old: DailyItem = { id: 'y', type: 'fact', textEn: 'y', textHi: 'y', active: false, createdAt: null, removedAt: null }; // pre-1.4.1 "off"
    expect(pickDaily([old], t)).toBeNull();
  });

  it('the bundled list with nothing removed is unchanged from 1.4.0 (same fact today)', () => {
    // 1.4.0's pickDaily on the bundled list = (day - epoch) mod 60 in id order
    const { BUNDLED_DAILY_ITEMS } = jest.requireActual('../dailyItems') as typeof import('../dailyItems');
    const NOW = Date.UTC(2026, 9, 12, 6, 0);
    const idx = (istDayNumber(NOW) - DAILY_EPOCH_DAY) % 60;
    expect(pickDaily(BUNDLED_DAILY_ITEMS, NOW)!.id).toBe([...BUNDLED_DAILY_ITEMS].sort((a, b) => (a.id < b.id ? -1 : 1))[idx].id);
    expect(istDayStart(NOW)).toBeLessThan(NOW);
  });
});

describe('V140-4 / V140-6: email case folding', () => {
  it('final sigma and the other simple folds', () => {
    expect(emailFold('ΟΔΟΣ@x.in')).toBe('οδοσ@x.in');
    expect(emailKey('οδος@x.in')).toBe(emailKey('ΟΔΟΣ@x.in'));
    expect(checkEmail('οδος@x.in')).toBe('οδοσ@x.in');
    expect(emailKey('\u017Fam@x.in')).toBe('sam@x.in'); // long s
    expect(emailKey('straße@x.in')).toBe('straße@x.in'); // no full fold: ß stays
    expect(emailKey('ｒace@x.in')).not.toBe(emailKey('race@x.in'));
  });
  it('a letter still upper case after folding is refused (as the Firebase rules do)', () => {
    expect(() => checkEmail('\u2102ab@x.in')).toThrow(); // ℂ has no lower case
    expect(checkEmail('JOSÉ@x.in')).toBe('josé@x.in');
    expect(checkEmail('ǅx@x.in')).toBe('ǆx@x.in');
    expect(checkEmail('bob2@x.in\u00A0')).toBe('bob2@x.in'); // trailing NBSP trimmed
    expect(() => checkEmail('bo\u00A0b@x.in')).toThrow();
  });
});
