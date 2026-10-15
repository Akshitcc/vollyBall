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
  primary: '#FF6A13', onPrimary: '#2A2452', primaryText: '#B4460A',
  ink: '#2A2452', ink2: '#2B2263', inkSelected: '#3D3285', onInk: '#FFFFFF', onInkMuted: '#E9E5FA',
  bg: '#FFFAF3', card: '#FFFFFF', surface: '#FFF5E6',
  text: '#2A2452', muted: '#5E5779', placeholder: '#625A7C', border: '#6B6590', hairline: '#F1E8DA', divider: '#F8F0E4',
  tabInactive: '#C3BCE0',
  red: '#E0393E', gold: '#FFC531', goldText: '#7A4E00', goldTint: '#FFF0C7',
  lossText: '#B42318', lossBg: '#FDE2E2', successStrong: '#166534', successBg: '#DDF5E8',
  court: '#FFE6D2', blueLine: '#FFC531',
  danger: '#C81E3A', live: '#C81E3A', success: '#15803D', successFill: '#BDEFD8',
  warnBg: '#FFEBC9', selectedBg: '#FFEBC9', tint: '#FFEBC9', white: '#FFFFFF',
  disabledBg: '#EDE6DA', disabledText: '#584F72',
  teamA: '#D93636', teamB: '#001F4D',
  mapBg: '#E4EFD9', mapRoad: '#FFFFFF', mapRoadMajor: '#F3DFC2', mapTournament: '#6A1B9A',
  userDot: '#2A2452', userHalo: 'rgba(255,106,19,0.30)',
  header: '#FFFAF3', onHeader: '#2A2452',
  scrim: 'rgba(42,36,82,0.45)', scrimLight: 'rgba(27,19,64,0.25)', toast: 'rgba(42,36,82,0.94)', onTeamScrim: 'rgba(0,0,0,0.3)',
};
export type ThemeTokens = { [K in keyof typeof SUNDAY_COURT]: string };

export const FLOODLIGHT: ThemeTokens = {
  primary: '#C6FF1A', onPrimary: '#141C30', primaryText: '#C6FF1A',
  ink: '#1A2440', ink2: '#33446A', inkSelected: '#45578A', onInk: '#FFFFFF', onInkMuted: '#C9D2E8',
  bg: '#1E2A44', card: '#283654', surface: '#33446A',
  text: '#F4F7FF', muted: '#C3CDE3', placeholder: '#97A3C0', border: '#7A8BB8', hairline: '#3A4A70', divider: '#304064',
  tabInactive: '#C3CDE3',
  red: '#FF5A5F', gold: '#FFC727', goldText: '#FFD75E', goldTint: '#2B2512',
  lossText: '#FF9A9A', lossBg: '#3A1620', successStrong: '#86EFAC', successBg: '#10301F',
  court: '#2A3858', blueLine: '#2DD4F0',
  danger: '#FF7A85', live: '#C81E3A', success: '#4ADE80', successFill: '#4ADE80',
  warnBg: '#33446A', selectedBg: '#33446A', tint: '#33446A', white: '#FFFFFF',
  disabledBg: '#33446A', disabledText: '#C9D2E8', // 1.4.24 (V1423-3): ~9:1, clearly readable but muted
  teamA: '#D93636', teamB: '#001F4D',
  mapBg: '#22344A', mapRoad: '#33446A', mapRoadMajor: '#45578A', mapTournament: '#B48CFF',
  userDot: '#C6FF1A', userHalo: 'rgba(198,255,26,0.30)',
  header: '#1E2A44', onHeader: '#F4F7FF',
  scrim: 'rgba(10,16,32,0.60)', scrimLight: 'rgba(0,0,0,0.3)', toast: 'rgba(51,68,106,0.96)', onTeamScrim: 'rgba(0,0,0,0.3)',
};

/** Gradients that follow the theme (hero cards, progress bars, rank cards). Team / medal gradients are fixed. */
export const THEME_GRADIENTS: Record<ThemeName, { hero: readonly string[]; progress: readonly string[]; rankCard: readonly string[]; potm: readonly string[] }> = {
  day: { hero: ['#3A3283', '#433A93', '#4C43A0'], progress: ['#B4460A', '#FF6A13'], rankCard: ['#FFEBC9', '#FFFFFF'], potm: ['#FFF0C7', '#FFFFFF'] },
  night: { hero: ['#3A3478', '#283654', '#1F4A5A'], progress: ['#8B6CFF', '#C6FF1A'], rankCard: ['#33446A', '#283654'], potm: ['#3A3424', '#283654'] },
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
