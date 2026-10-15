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
  /** 1.4.25 (bright tokens): live/error TEXT on bg/surface (Night #FF8A9C; `live` stays the badge fill); offset-shadow colour
   *  (Day ink at 20%); translucent tab bar / header fill. */
  liveText: string; shadowColor: string; tabBarBg: string;
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
    bg: '#FFFAF3', surface: '#FFFFFF', surface2: '#FFF5E6', outline: '#6B6590', text: '#2A2452', textMuted: '#5E5779',
    primary: '#FF6A13', onPrimary: '#2A2452', accent: '#FFC531', teamA: '#FF6A13', teamAText: '#B4460A', teamB: '#0B6E6A', onTeamB: '#FFFFFF',
    live: '#C81E3A', onLive: '#FFFFFF', liveText: '#C81E3A', shadowColor: 'rgba(42,36,82,0.20)', tabBarBg: 'rgba(255,250,243,0.94)', success: '#BDEFD8', tabActive: '#2A2452', scrim: 'rgba(42,36,82,0.45)',
    pink: '#FFB4C8', track: '#F1E8DA', hero: ['#FF6A13', '#FF6A13', '#FF6A13'],
    radius: { card: 22, btn: 16, chip: 18 }, border: { card: 2 },
    font: { bodyHi: 'Hind-Regular', boldHi: 'Hind-Bold', displayHi: 'Baloo2-ExtraBold', score: 'Baloo2-ExtraBold',
      display: 'Baloo2-ExtraBold', body: 'Hind-Regular', bold: 'Hind-Bold', semibold: 'Hind-SemiBold', upperDisplay: false },
    shadow: { card: 3, btn: 3, glow: null }, // 1.4.25: 3 3 0 in ink at 20% (was 4/3 solid ink)
    statusBar: 'dark',
  },
  night: {
    bg: '#1E2A44', surface: '#283654', surface2: '#33446A', outline: '#7A8BB8', text: '#F4F7FF', textMuted: '#C3CDE3',
    primary: '#C6FF1A', onPrimary: '#141C30', accent: '#8B6CFF', teamA: '#FF6B70', teamAText: '#FF8A8E', teamB: '#2DD4F0', onTeamB: '#141C30',
    live: '#FF4D6A', onLive: '#141C30', liveText: '#FF8A9C', shadowColor: 'transparent', tabBarBg: 'rgba(30,42,68,0.94)', success: '#C6FF1A', tabActive: '#C6FF1A', scrim: 'rgba(10,16,32,0.60)',
    pink: '#33446A', track: '#3A4A70', hero: ['#3A3478', '#283654', '#1F4A5A'],
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
  ['teamAText', 'surface'], ['teamAText', 'bg'], ['onTeamB', 'teamB'], ['onLive', 'live'], ['text', 'surface2'], ['tabActive', 'surface'],
  // 1.4.22 mockup fills carrying text
  ['text', 'pink'], ['onPrimary', 'success'],
  // 1.4.25
  ['liveText', 'bg'], ['liveText', 'surface'],
];
