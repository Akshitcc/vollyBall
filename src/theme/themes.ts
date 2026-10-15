/**
 * 1.4.21 – automatic day/night themes. ONE token map per theme, same keys as `colors` (theme/index.ts).
 * Sources: /workspace/volleylive-design/directions (B "Sunday Court" = day, A "Floodlight" = night).
 *
 * SWAPPING TOKENS (Figma Designer spec): edit the two objects below – nothing else. Every key is required (the
 * `ThemeTokens` type enforces it) and contrast.test.ts / themes1421.test.ts re-check WCAG AA for every text pair.
 * Team default colours (teamA/teamB) are DATA (saved on teams) and stay the same in both themes.
 */
import type { ThemeName } from './resolve';
export type { ThemeName } from './resolve';
/* 1.4.21: the legacy `colors` keys per theme, aligned with the spec tokens (tokens.ts), so every existing screen follows the theme. */

export const SUNDAY_COURT = {
  primary: '#FF6A13', onPrimary: '#1B1340', primaryText: '#B4460A',
  ink: '#1B1340', ink2: '#2B2263', inkSelected: '#3D3285', onInk: '#FFFFFF', onInkMuted: '#E9E5FA',
  bg: '#FFF4E2', card: '#FFFFFF', surface: '#FFF4E2',
  text: '#1B1340', muted: '#584F72', placeholder: '#625A7C', border: '#857C9C', hairline: '#EADBC2', divider: '#F5EAD7',
  tabInactive: '#C3BCE0',
  red: '#E0393E', gold: '#FFC531', goldText: '#7A4E00', goldTint: '#FFF0C7',
  lossText: '#B42318', lossBg: '#FDE2E2', successStrong: '#166534', successBg: '#DDF5E8',
  court: '#FFE6D2', blueLine: '#FFC531',
  danger: '#C81E3A', live: '#C81E3A', success: '#15803D', successFill: '#BDEFD8',
  warnBg: '#FFEBC9', selectedBg: '#FFEBC9', tint: '#FFEBC9', white: '#FFFFFF',
  disabledBg: '#EDE6DA', disabledText: '#584F72',
  teamA: '#D93636', teamB: '#001F4D',
  mapBg: '#E4EFD9', mapRoad: '#FFFFFF', mapRoadMajor: '#F3DFC2', mapTournament: '#6A1B9A',
  userDot: '#1B1340', userHalo: 'rgba(255,106,19,0.30)',
  header: '#FFF4E2', onHeader: '#1B1340',
  scrim: 'rgba(27,19,64,0.55)', scrimLight: 'rgba(27,19,64,0.25)', toast: 'rgba(27,19,64,0.94)', onTeamScrim: 'rgba(0,0,0,0.3)',
};
export type ThemeTokens = { [K in keyof typeof SUNDAY_COURT]: string };

export const FLOODLIGHT: ThemeTokens = {
  primary: '#C6FF1A', onPrimary: '#0A0E1A', primaryText: '#C6FF1A',
  ink: '#0F1424', ink2: '#232C47', inkSelected: '#33406A', onInk: '#FFFFFF', onInkMuted: '#C9D2E8',
  bg: '#0A0E1A', card: '#151B2E', surface: '#232C47',
  text: '#F4F7FF', muted: '#A3AFCB', placeholder: '#97A3C0', border: '#66739A', hairline: '#2A3352', divider: '#1C2338',
  tabInactive: '#A3AFCB',
  red: '#FF5A5F', gold: '#FFC727', goldText: '#FFD75E', goldTint: '#2B2512',
  lossText: '#FF9A9A', lossBg: '#3A1620', successStrong: '#86EFAC', successBg: '#10301F',
  court: '#1B2440', blueLine: '#2DD4F0',
  danger: '#FF7A85', live: '#C81E3A', success: '#4ADE80', successFill: '#4ADE80',
  warnBg: '#1F2A4A', selectedBg: '#1F2A4A', tint: '#1F2A4A', white: '#FFFFFF',
  disabledBg: '#232C47', disabledText: '#C9D2E8', // 1.4.24 (V1423-3): ~9:1, clearly readable but muted
  teamA: '#D93636', teamB: '#001F4D',
  mapBg: '#142028', mapRoad: '#232C47', mapRoadMajor: '#2E3A5C', mapTournament: '#B48CFF',
  userDot: '#C6FF1A', userHalo: 'rgba(198,255,26,0.30)',
  header: '#0A0E1A', onHeader: '#F4F7FF',
  scrim: 'rgba(3,5,12,0.72)', scrimLight: 'rgba(0,0,0,0.3)', toast: 'rgba(35,44,71,0.96)', onTeamScrim: 'rgba(0,0,0,0.3)',
};

/** Gradients that follow the theme (hero cards, progress bars, rank cards). Team / medal gradients are fixed. */
export const THEME_GRADIENTS: Record<ThemeName, { hero: readonly string[]; progress: readonly string[]; rankCard: readonly string[]; potm: readonly string[] }> = {
  day: { hero: ['#1B1340', '#2B2263', '#3D3285'], progress: ['#B4460A', '#FF6A13'], rankCard: ['#FFEBC9', '#FFFFFF'], potm: ['#FFF0C7', '#FFFFFF'] },
  night: { hero: ['#1B1446', '#151B2E', '#0E2A35'], progress: ['#8B6CFF', '#C6FF1A'], rankCard: ['#1F2A4A', '#151B2E'], potm: ['#2B2512', '#151B2E'] },
};
export const THEMES: Record<ThemeName, ThemeTokens> = { day: SUNDAY_COURT, night: FLOODLIGHT };
export const THEME_LABEL: Record<ThemeName, string> = { day: 'Sunday Court', night: 'Floodlight' };

/** Text pairs that must reach WCAG AA (4.5:1) in BOTH themes – [foreground key, background key]. */
export const AA_TEXT_PAIRS: [keyof ThemeTokens, keyof ThemeTokens][] = [
  ['text', 'bg'], ['text', 'card'], ['text', 'surface'], ['text', 'tint'],
  ['muted', 'bg'], ['muted', 'card'], ['muted', 'surface'],
  ['placeholder', 'card'], ['placeholder', 'bg'],
  ['primaryText', 'card'], ['primaryText', 'bg'],
  ['onPrimary', 'primary'], ['onInk', 'ink'], ['onInkMuted', 'ink'], ['onInk', 'ink2'], ['onInk', 'inkSelected'],
  ['danger', 'card'], ['danger', 'bg'], ['success', 'card'], ['goldText', 'card'], ['goldText', 'goldTint'],
  ['lossText', 'lossBg'], ['successStrong', 'successBg'], ['disabledText', 'disabledBg'],
  ['onInk', 'live'], ['onPrimary', 'successFill'], ['tabInactive', 'ink'], ['primary', 'ink'], ['onHeader', 'header'],
];
/** Control boundaries: 3:1 (WCAG 1.4.11). */
export const AA_UI_PAIRS: [keyof ThemeTokens, keyof ThemeTokens][] = [['border', 'card'], ['border', 'bg']];
