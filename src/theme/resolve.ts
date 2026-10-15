/**
 * 1.4.21 day/night logic – from the Designer spec (volleylive-design/daynight/daynight-spec.md §1, §5).
 * DEVIATION (Akshit's call, flagged in RELEASE-1.4.21): Auto is PURELY time-based – the spec's "OS dark mode wins in
 * Auto" rule is left out, so resolveTheme takes no OS argument.
 */
export type ThemeSetting = 'auto' | 'day' | 'night';
export type ThemeName = 'day' | 'night';
export const THEME_SETTINGS: readonly ThemeSetting[] = ['auto', 'day', 'night'];
export const DAY_START = 6 * 60, NIGHT_START = 18 * 60;

export function timeTheme(d = new Date()): ThemeName {
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= DAY_START && m < NIGHT_START ? 'day' : 'night';
}
export function resolveTheme(setting: ThemeSetting, d = new Date()): ThemeName {
  if (setting !== 'auto') return setting;
  return timeTheme(d);
}
/** ms until the next 06:00 or 18:00 boundary */
export function msToNextBoundary(d = new Date()): number {
  const n = new Date(d); n.setSeconds(0, 0);
  const m = d.getHours() * 60 + d.getMinutes();
  const target = m < DAY_START ? DAY_START : m < NIGHT_START ? NIGHT_START : DAY_START + 24 * 60;
  n.setHours(0, target, 0, 0);
  return Math.max(1000, n.getTime() - d.getTime());
}
export type Greeting = 'morning' | 'afternoon' | 'evening' | 'night';
export function greeting(d = new Date()): Greeting {
  const h = d.getHours();
  return h >= 5 && h < 12 ? 'morning' : h < 17 && h >= 12 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
}
/** ms until the next whole local minute (greeting refresh, spec §5 "every minute boundary"). */
export function msToNextMinute(d = new Date()): number {
  return (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 50;
}
export const isThemeSetting = (v: unknown): v is ThemeSetting => typeof v === 'string' && (THEME_SETTINGS as readonly string[]).includes(v);
/** First word of the display name ('' when none). */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().split(/\s+/)[0] ?? '';
}
