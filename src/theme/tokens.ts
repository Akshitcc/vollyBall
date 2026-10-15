/**
 * 1.4.21 Day/Night tokens – Designer spec v2 §2 (volleylive-design/daynight/daynight-spec.md). Same semantic names, two
 * values. Components read them via `useTheme().t`. To re-skin, edit THIS file (and themes.ts for the legacy keys);
 * theme tests re-check WCAG AA.
 */
import type { ThemeName } from './resolve';

export type Tokens = {
  bg: string; surface: string; surface2: string; outline: string; text: string; textMuted: string;
  primary: string; onPrimary: string; accent: string; teamA: string; teamAText: string; teamB: string; onTeamB: string;
  live: string; onLive: string; success: string; tabActive: string; scrim: string;
  /** 1.4.22 decor colours used by the v2 mockups (fills only, text on them is `text`): Day pink sticker / Night surface2;
   *  track = progress track; hero = Live hero fill (Day primary, Night 3-stop gradient start/mid/end). */
  pink: string; track: string; hero: [string, string, string];
  radius: { card: number; btn: number; chip: number };
  border: { card: number };
  /** Font families. Night + Hindi = Mukta (spec §2: Teko has no Devanagari). Other spec fonts not bundled yet → system. */
  font: {
    bodyHi: string | undefined; boldHi: string | undefined; displayHi: string | undefined; score: string | undefined;
    /** 1.4.22 full spec families (§2 non-colour tokens): Day Baloo 2 800 + Hind; Night Teko 600 (UPPERCASE Latin) + Mukta. */
    display: string; body: string; bold: string; semibold: string; upperDisplay: boolean;
  };
  /** 1.4.22 spec shadow.card / btn: Day = hard ink offset (drawn as a View); Night = none, glow on primary only. */
  shadow: { card: number; btn: number; glow: string | null };
  statusBar: 'dark' | 'light';
};

export const tokens: Record<ThemeName, Tokens> = {
  day: {
    bg: '#FFF4E2', surface: '#FFFFFF', surface2: '#FFF4E2', outline: '#1B1340', text: '#1B1340', textMuted: '#584F72',
    primary: '#FF6A13', onPrimary: '#1B1340', accent: '#FFC531', teamA: '#FF6A13', teamAText: '#B4460A', teamB: '#0B6E6A', onTeamB: '#FFFFFF',
    live: '#C81E3A', onLive: '#FFFFFF', success: '#BDEFD8', tabActive: '#1B1340', scrim: 'rgba(27,19,64,0.55)',
    pink: '#FFB4C8', track: '#EADFCB', hero: ['#FF6A13', '#FF6A13', '#FF6A13'],
    radius: { card: 22, btn: 16, chip: 18 }, border: { card: 2 },
    font: { bodyHi: 'Hind-Regular', boldHi: 'Hind-Bold', displayHi: 'Baloo2-ExtraBold', score: 'Baloo2-ExtraBold',
      display: 'Baloo2-ExtraBold', body: 'Hind-Regular', bold: 'Hind-Bold', semibold: 'Hind-SemiBold', upperDisplay: false },
    shadow: { card: 4, btn: 3, glow: null },
    statusBar: 'dark',
  },
  night: {
    bg: '#0A0E1A', surface: '#151B2E', surface2: '#232C47', outline: '#33406A', text: '#F4F7FF', textMuted: '#A3AFCB',
    primary: '#C6FF1A', onPrimary: '#0A0E1A', accent: '#8B6CFF', teamA: '#FF5A5F', teamAText: '#FF5A5F', teamB: '#2DD4F0', onTeamB: '#0A0E1A',
    live: '#FF3B5C', onLive: '#0A0E1A', success: '#C6FF1A', tabActive: '#C6FF1A', scrim: 'rgba(3,5,12,0.72)',
    pink: '#232C47', track: '#2B3247', hero: ['#1B1446', '#151B2E', '#0E2A35'],
    radius: { card: 20, btn: 14, chip: 18 }, border: { card: 1 },
    font: { bodyHi: 'Mukta-Regular', boldHi: 'Mukta-Bold', displayHi: 'Mukta-ExtraBold', score: 'Teko-SemiBold', // v2 §4.2: score numerals stay Teko, also in Hindi
      display: 'Teko-SemiBold', body: 'Mukta-Regular', bold: 'Mukta-Bold', semibold: 'Mukta-Bold', upperDisplay: true },
    shadow: { card: 0, btn: 0, glow: 'rgba(198,255,26,0.35)' },
    statusBar: 'light',
  },
};
/** Spec §2 AA table: [fg, bg] text pairs that must reach 4.5:1 in both themes. */
export const SPEC_TEXT_PAIRS: [keyof Tokens, keyof Tokens][] = [
  ['text', 'bg'], ['text', 'surface'], ['textMuted', 'surface'], ['textMuted', 'bg'], ['onPrimary', 'primary'],
  ['teamAText', 'surface'], ['teamAText', 'bg'], ['onTeamB', 'teamB'], ['onLive', 'live'], ['live', 'bg'], ['text', 'surface2'], ['tabActive', 'surface'],
  // 1.4.22 mockup fills carrying text
  ['text', 'pink'], ['onPrimary', 'success'],
];
