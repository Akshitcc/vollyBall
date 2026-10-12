/**
 * 1.4.0 core: V139-4 (daily rotation – property tests), V139-2 (NFC emails), V139-3 (email key / claim id),
 * V139-5 (guardUpdate: createdAt, past scheduledAt).
 */
import { BUNDLED_DAILY_ITEMS, DAILY_EPOCH_DAY, istDayNumber, istDayStart, mergeDailyItems, pickDaily, type DailyItem } from '../dailyItems';
import { checkEmail, emailClaimId, emailKey } from '../registration';
import { guardUpdate } from '../matchGuards';
import type { Match } from '../types';

const DAY = 86_400_000;
const item = (id: string, createdAt: number | null, active = true): DailyItem => ({ id, type: 'fact', textEn: id, textHi: id, attribution: null, sourceUrl: null, active, createdAt });
/** deterministic PRNG (mulberry32) so a failure is reproducible */
const rng = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noonIst = (day: number) => Date.UTC(1970, 0, 1) + day * DAY + 6.5 * 3600_000; // 12:00 IST of an IST day number

describe('V139-4: daily rotation in cycles', () => {
  /**
   * Simulates `days` days from `from`: on each day some items are added (createdAt during that day, after
   * the card was first shown). Checks, for every day:
   *  - stability: today's pick with the items known in the morning == with the items known at night;
   *  - every active item is unseen for at most n days (n = active items that day), counting a new item
   *    from the day it was added.
   */
  function simulate(seed: number, opts: { from: number; days: number; start: DailyItem[]; addP: number; maxAdd: number; undatedP?: number }) {
    const r = rng(seed);
    let items = opts.start.slice();
    const lastSeen = new Map<string, number>(); // id → last day shown (or the day it was added / start)
    for (const i of items) lastSeen.set(i.id, opts.from - 1);
    let k = 0;
    const maxGap = { gap: 0, n: 0 };
    for (let d = opts.from; d < opts.from + opts.days; d++) {
      const morning = noonIst(d) - 5 * 3600_000; // 07:00 IST
      const picked = pickDaily(items, morning);
      // adds during the day (server time = that day)
      const adds = r() < opts.addP ? 1 + Math.floor(r() * opts.maxAdd) : 0;
      for (let a = 0; a < adds; a++) {
        const id = `${String.fromCharCode(97 + Math.floor(r() * 26))}${k++}`; // random-ish ids: order must not depend on them
        const undated = r() < (opts.undatedP ?? 0);
        items = [...items, item(id, undated ? null : morning + 3600_000 + a * 60_000)];
        if (!undated) lastSeen.set(id, d);
      }
      const night = noonIst(d) + 11 * 3600_000; // 23:00 IST
      const again = pickDaily(items, night);
      expect(again?.id ?? null).toBe(picked?.id ?? null); // adding never changes today's fact (nor "none yet")
      if (picked) lastSeen.set(picked.id, d);
      const n = items.filter((i) => i.active).length;
      for (const i of items) {
        if (!lastSeen.has(i.id)) continue; // undated added mid-way: it reshapes the cycles (documented), not checked
        const gap = d - lastSeen.get(i.id)!;
        if (gap > maxGap.gap) Object.assign(maxGap, { gap, n });
        if (gap > n) throw new Error(`seed ${seed}: ${i.id} unseen for ${gap} days on day ${d} (n = ${n})`);
      }
    }
    return { items, maxGap };
  }

  it('property: random add schedules over 2 years – today stable on add, nothing unseen for more than n days', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const start = seed % 2 ? BUNDLED_DAILY_ITEMS.slice() : BUNDLED_DAILY_ITEMS.slice(0, 1 + (seed % 7));
      simulate(seed, { from: istDayNumber(Date.UTC(2026, 9, 12)), days: 730, start, addP: seed % 3 === 0 ? 0.5 : 0.08, maxAdd: 3 });
    }
  });

  it('property: also from an empty list and from the epoch', () => {
    for (let seed = 100; seed < 110; seed++) simulate(seed, { from: DAILY_EPOCH_DAY, days: 400, start: [], addP: 0.3, maxAdd: 2 });
  });

  it('every item exactly once per cycle; a new item leads the next cycle and is shown within n − 1 days', () => {
    const NOW = Date.UTC(2026, 9, 12, 6, 0); // 11:30 IST
    for (const id of ['a0', 'b00', 'b30x', 'zz', 'b40x']) {
      const merged = mergeDailyItems([item(id, NOW)]);
      const n = merged.length;
      const today = istDayNumber(NOW);
      const shown = Array.from({ length: 2 * n }, (_, k) => pickDaily(merged, noonIst(today + k))!.id);
      const first = shown.indexOf(id);
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThanOrEqual(n - 1); // tester's 1.3.9: 1, 2 or 32 days depending on the id
      // the cycle it leads shows all n items once
      expect(new Set(shown.slice(first, first + n)).size).toBe(n);
    }
  });

  it('tester case: 60 facts + one added – b40 is never unseen for more than 61 days (1.3.9: 101)', () => {
    const NOW = Date.UTC(2026, 9, 12, 6, 0);
    const merged = mergeDailyItems([item('b30x', NOW)]);
    const today = istDayNumber(NOW);
    let last = today - 1;
    let worst = 0;
    // b40's last showing before today, with the 60 bundled facts (≤ 60 days back)
    for (let k = 0; k < 60; k++) if (pickDaily(BUNDLED_DAILY_ITEMS, noonIst(today - 1 - k))!.id === 'b40') { last = today - 1 - k; break; }
    for (let d = today; d < today + 400; d++) {
      if (pickDaily(merged, noonIst(d))!.id === 'b40') {
        worst = Math.max(worst, d - last);
        last = d;
      }
    }
    worst = Math.max(worst, today + 400 - last);
    expect(worst).toBeLessThanOrEqual(61);
  });

  // 1.4.1 (V140-7): changed – the phone clock is no longer compared with createdAt (a phone behind the server
  // reshaped the rotation). A future createdAt (demo only: phone time) simply joins when that day comes, and
  // doesn't change today's fact.
  it('a createdAt in the future (demo phone clock ahead) joins on its day and never changes today', () => {
    const NOW = Date.UTC(2026, 9, 12, 6, 0);
    const merged = mergeDailyItems([item('future', NOW + 400 * DAY)]);
    const today = istDayNumber(NOW);
    expect(pickDaily(merged, NOW)!.id).toBe(pickDaily(BUNDLED_DAILY_ITEMS, NOW)!.id);
    const later = new Set(Array.from({ length: merged.length + 1 }, (_, k) => pickDaily(merged, noonIst(today + 401 + k))!.id));
    expect(later.has('future')).toBe(true);
  });

  it('pure function of the IST date; inactive items are skipped; empty → null; before the epoch still cycles', () => {
    const NOW = Date.UTC(2026, 9, 12, 6, 0);
    expect(pickDaily(BUNDLED_DAILY_ITEMS, istDayStart(NOW))!.id).toBe(pickDaily(BUNDLED_DAILY_ITEMS, istDayStart(NOW) + DAY - 1)!.id);
    expect(pickDaily(BUNDLED_DAILY_ITEMS, istDayStart(NOW) - 1)!.id).not.toBe(pickDaily(BUNDLED_DAILY_ITEMS, istDayStart(NOW))!.id);
    const off = BUNDLED_DAILY_ITEMS.map((x) => ({ ...x, active: x.id === 'b07' }));
    expect(pickDaily(off, NOW)!.id).toBe('b07');
    expect(pickDaily([], NOW)).toBeNull();
    expect(pickDaily([item('later', NOW)], NOW)).toBeNull(); // only item added today: from tomorrow
    expect(pickDaily([item('later', NOW)], NOW + DAY)!.id).toBe('later');
    const old = Date.UTC(2025, 5, 1);
    expect(new Set(Array.from({ length: 60 }, (_, k) => pickDaily(BUNDLED_DAILY_ITEMS, old + k * DAY)!.id)).size).toBe(60);
  });
});

describe('V139-2 / V139-3: emails NFC, one key', () => {
  it('decomposed and composed forms are the same address', () => {
    expect(checkEmail('jose\u0301@x.in')).toBe('josé@x.in');
    expect(checkEmail(' JOSE\u0301@X.IN ')).toBe('josé@x.in');
    expect(checkEmail('jose\u0301@x.in')).toBe(checkEmail('JOSÉ@x.in'));
    expect(checkEmail('straße@x.in')).not.toBe(checkEmail('strasse@x.in')); // accents/ß still count
    expect(emailKey('Jose\u0301@X.in ')).toBe(emailKey('josé@x.in'));
    expect(emailKey('  ')).toBeNull();
  });
  it('claim ids escape % and / (as firestore.rules emailClaimId)', () => {
    expect(emailClaimId('a/b%c@d.in')).toBe('a%2Fb%25c@d.in');
    expect(emailClaimId('a@b.in')).toBe('a@b.in');
  });
});

describe('V139-5: guardUpdate refuses createdAt changes and a past scheduledAt (all clients)', () => {
  const now = Date.UTC(2026, 9, 12, 6, 0);
  const m = { id: 'm1', status: 'scheduled', events: [], createdAt: now - DAY, scheduledAt: now + DAY, teamA: { name: 'A', players: [] }, teamB: { name: 'B', players: [] } } as unknown as Match;
  const code = (f: () => void) => { try { f(); return null; } catch (e) { return (e as { code?: string }).code; } };
  it('createdAt / id', () => {
    expect(code(() => guardUpdate(m, { createdAt: 1 }, now))).toBe('server_field');
    expect(code(() => guardUpdate(m, { id: 'other' } as Partial<Match>, now))).toBe('server_field');
    expect(code(() => guardUpdate(m, { createdAt: m.createdAt }, now))).toBeNull(); // unchanged copy is fine
  });
  it('scheduledAt: past refused while scheduled, future fine, unchanged fine, a live match not checked', () => {
    expect(code(() => guardUpdate(m, { scheduledAt: 1 }, now))).toBe('time_in_past');
    expect(code(() => guardUpdate(m, { scheduledAt: now - DAY }, now))).toBe('time_in_past');
    expect(code(() => guardUpdate(m, { scheduledAt: now + 2 * DAY }, now))).toBeNull();
    expect(code(() => guardUpdate({ ...m, scheduledAt: now - DAY }, { scheduledAt: now - DAY, title: 'x' } as Partial<Match>, now))).toBeNull();
    expect(code(() => guardUpdate({ ...m, status: 'live' } as Match, { scheduledAt: now - DAY }, now))).toBeNull();
  });
});
