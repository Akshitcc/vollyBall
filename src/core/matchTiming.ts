/**
 * 1.4.26 (Tester E2E-8): a scheduled match whose time has passed is no longer "UPCOMING": it is OVERDUE (start time
 * passed, nobody started it yet) and, a day later, NOT PLAYED.
 */
export const NOT_PLAYED_AFTER_MS = 24 * 60 * 60_000;
export type ScheduledState = 'upcoming' | 'overdue' | 'notPlayed';

export function scheduledState(m: { status: string; scheduledAt?: number | null }, now = Date.now()): ScheduledState | null {
  if (m.status !== 'scheduled') return null;
  if (m.scheduledAt == null || m.scheduledAt > now) return 'upcoming';
  return now - m.scheduledAt >= NOT_PLAYED_AFTER_MS ? 'notPlayed' : 'overdue';
}

/** The i18n key of the status chip (matchStatus.*). */
export function statusKey(m: { status: string; scheduledAt?: number | null }, now = Date.now()): string {
  const s = scheduledState(m, now);
  return s === 'overdue' ? 'matchStatus.overdue' : s === 'notPlayed' ? 'matchStatus.notPlayed' : `matchStatus.${m.status}`;
}
