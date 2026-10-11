/**
 * Local-calendar helpers for the day/time chips. Everything uses LOCAL getters/setters (setDate,
 * setHours) on the device's clock: never toISOString() or getUTC*() (in India those are 5:30 behind,
 * so between 00:00 and 05:30 IST "today" would still be yesterday). setDate also stays right
 * across DST changes where adding 86 400 000 ms would not.
 */

/** Start times may be this far in the past (clock skew, time spent on the form). Same on server + rules. */
export const PAST_GRACE_MS = 15 * 60 * 1000;

/** Local midnight `offset` days from `now`. */
export function localDayStart(offset = 0, now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

/** `hour`:`minute` local time on the day `offset` days from `now`. */
export function localAt(offset: number, hour: number, now: number = Date.now(), minute = 0): number {
  const d = new Date(localDayStart(offset, now));
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** Whole local days between `now`'s day and `ts`'s day (0 = today, 1 = tomorrow). */
export function localDayOffset(ts: number, now: number = Date.now()): number {
  const a = new Date(localDayStart(0, now));
  const b = new Date(ts);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** YYYY-MM-DD of the local day (for keys/labels; NOT toISOString()). */
export function localDateKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when a start time is already over (beyond the grace window). */
export function isPastStart(ts: number, now: number = Date.now(), grace = PAST_GRACE_MS): boolean {
  return ts < now - grace;
}

/** First chip hour that is still ahead today, or null when they are all over. */
export function firstFutureHour(hours: readonly number[], offset: number, now: number = Date.now()): number | null {
  return hours.find((h) => !isPastStart(localAt(offset, h, now), now, 0)) ?? null;
}

/**
 * Tournament start/end from the chips: starts 09:00 local on day `startIn` (if that is already over
 * today, it starts now), finishes 18:00 local on its last day, and never ends before it starts.
 */
export function tournamentDates(startIn: number, days: number, now: number = Date.now()): { startDate: number; endDate: number } {
  const startDate = Math.max(localAt(startIn, 9, now), startIn === 0 ? now : 0);
  const endDate = Math.max(localAt(startIn + Math.max(1, days) - 1, 18, now), startDate);
  return { startDate, endDate };
}

export const PAST_TIME_CODE = 'time_in_past';
export const END_BEFORE_START_CODE = 'end_before_start';
