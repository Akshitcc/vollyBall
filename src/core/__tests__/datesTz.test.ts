/**
 * Local-date helpers (src/core/dates.ts) in four time zones (QA retest 217 #8): UTC, India,
 * Los Angeles (DST) and Kiritimati (UTC+14, where "today" is ahead of almost everyone). Each zone
 * runs in its own Node process with TZ set for that process only; the expected wall-clock values
 * come from Intl with an explicit timeZone, so nothing depends on the machine's zone or on a
 * globalSetup.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const ZONES = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati'];
// Instants just after midnight in each zone, around the LA DST changes, and late evening.
const INSTANTS = [
  '2026-10-10T19:20:00Z', // 00:50 IST on 11 Oct (QA B2)
  '2026-10-10T10:20:00Z', // 00:20 in Kiritimati on 11 Oct
  '2026-10-11T07:30:00Z', // 00:30 PDT on 11 Oct
  '2026-10-11T00:10:00Z', // 00:10 UTC
  '2026-03-08T10:30:00Z', // LA spring-forward day, 03:30 PDT
  '2026-11-01T08:30:00Z', // LA fall-back day, 01:30 PST
  '2026-10-11T15:40:00Z', // 21:10 IST, evening in Asia
].map((s) => Date.parse(s));

const WORKER = path.join(__dirname, 'helpers', 'datesTzWorker.js');

/** Wall clock of an instant in an explicit zone: { date: 'YYYY-MM-DD', hour, minute }. */
function wall(ts: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
/** Calendar date `n` days after a YYYY-MM-DD date. */
function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** UTC offset of a zone at an instant, in getTimezoneOffset() form (minutes, west positive). */
function tzOffset(ts: number, timeZone: string) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(ts)).find((p) => p.type === 'timeZoneName')!.value;
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return -(m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

describe.each(ZONES)('local dates in %s', (zone) => {
  const run = spawnSync(process.execPath, [WORKER, JSON.stringify(INSTANTS)], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
  const result = run.status === 0 ? JSON.parse(run.stdout) : null;
  test('the worker ran in that zone', () => {
    expect(run.stderr).toBe('');
    expect(result.tz).toBe(zone);
    // (ICU may report an alias, e.g. Asia/Calcutta; the per-instant offsets below prove the zone.)
    expect(result.rows.map((r: { now: number; offset: number }) => r.offset)).toEqual(INSTANTS.map((t) => tzOffset(t, zone)));
  });
  test.each(INSTANTS.map((now, i) => [new Date(now).toISOString(), i]))('at %s', (_label, i) => {
    const r = result.rows[i as number];
    const now = r.now as number;
    const today = wall(now, zone).date;
    expect(r.offset).toBe(tzOffset(now, zone));
    // Today / Tomorrow are the local calendar days, whatever the UTC date is.
    expect(r.today).toBe(today);
    expect(r.tomorrow).toBe(addDays(today, 1));
    expect(wall(r.todayStart, zone)).toEqual({ date: today, hour: 0, minute: 0 });
    // 18:00 tomorrow / 09:00 in three days, local wall clock (also across a DST change).
    expect(wall(r.at18Tomorrow, zone)).toEqual({ date: addDays(today, 1), hour: 18, minute: 0 });
    expect(wall(r.at9In3, zone)).toEqual({ date: addDays(today, 3), hour: 9, minute: 0 });
    expect(r.offsetOf18Tomorrow).toBe(1);
    expect(r.offsetOf9In3).toBe(3);
    // First chip hour still ahead today (local), or null.
    const w = wall(now, zone);
    const minutes = w.hour * 60 + w.minute;
    const ahead = [0, 6, 7, 18, 20, 23].find((h) => h * 60 > minutes) ?? null;
    expect(r.firstHour).toBe(ahead);
    // Tournament "Today, 1 day": starts max(09:00 local, now), ends 18:00 local, never before start.
    const nineToday = wall(r.tourToday.startDate, zone);
    if (r.tourToday.startDate === now) expect(minutes).toBeGreaterThanOrEqual(9 * 60);
    else expect(nineToday).toEqual({ date: today, hour: 9, minute: 0 });
    expect(r.tourToday.endDate).toBeGreaterThanOrEqual(r.tourToday.startDate);
    if (minutes < 18 * 60) expect(wall(r.tourToday.endDate, zone)).toEqual({ date: today, hour: 18, minute: 0 });
    // "In a week, 3 days": 09:00 local on day 7, 18:00 local on day 9.
    expect(wall(r.tourWeek.startDate, zone)).toEqual({ date: addDays(today, 7), hour: 9, minute: 0 });
    expect(wall(r.tourWeek.endDate, zone)).toEqual({ date: addDays(today, 9), hour: 18, minute: 0 });
    expect(r.tourWeekEndOffset).toBe(9);
  });
});
