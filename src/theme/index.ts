/**
 * VolleyLive theme (1.2.1 "Navy Live", /workspace/volleylive-design/design-spec.md): Paytm-like
 * navy + light blue on a cool light background, navy gradient heroes, gold for achievements.
 *
 * Contrast rules (WCAG AA, checked in src/theme/__tests__/contrast.test.ts; 4.5 text, 3 UI):
 *  - White on light blue #00BAF2 is only ~2.3:1, so light-blue buttons carry navy text (5.76:1).
 *  - Blue text and links on white use `primaryText` #0072BC (5.08:1 on white, 4.73 on #F5F7FA).
 *  - Navy #002E6E is only 2.8:1 from Team A red, so Team B defaults to a deeper navy #001F4D (3.48:1).
 *  - Success green #21C17A is 2.3:1 on white: it is a fill only; small success text uses #15803D.
 */
export const palette = {
  navy: '#002E6E',
  navyDeep: '#001F4D',
  navy2: '#083777',
  navySelected: '#1A4F96',
  blue: '#00BAF2',
  blueText: '#0072BC',
  blueTint: '#E6F7FD',
  white: '#FFFFFF',
  bg: '#F5F7FA',
  red: '#E53935',
  /** Team A red (white text on it reaches AA 4.63:1, 3.48:1 from Team B navy). */
  teamRed: '#D93636',
  redDark: '#C62828',
  grey100: '#EDF1F6',
  grey200: '#D8DFE9',
  grey400: '#9FB3CF',
  grey600: '#6B778A',
  grey700: '#4D5B70',
  greenFill: '#21C17A',
  green: '#15803D',
  purple: '#6A1B9A',
  // ---- 1.2.1 design tokens (design-spec §2) ----
  navyMid: '#003B8C',
  navyBright: '#0A56B5',
  blueLine: '#9ED9F2',
  court: '#DDF2FB',
  /** Control borders: 3:1 on white (3.36), bg (3.13) and tint (3.05) – Tester 1.2.0. */
  grey500: '#808DA2',
  /** Placeholder text: 5.03 on bg, 4.91 on tint, 5.4 on white (Tester 1.2.0). */
  grey650: '#5F6B7E',
  lossText: '#B42318',
  lossBg: '#FDE2E2',
  successStrong: '#166534',
  successBg: '#DCF5E7',
  syncIcon: '#5FD49B',
  gold: '#FFC727',
  goldText: '#8A5A00',
  goldTint: '#FFF6D6',
  silver: '#C9D3DF',
  silverDark: '#9FB0C4',
  bronze: '#E8A06A',
  bronzeDark: '#D98A4E',
} as const;

/** expo-linear-gradient stops (design-spec §2). */
export const gradients = {
  hero: ['#002E6E', '#003B8C', '#0A56B5'] as const,
  heroLocations: [0, 0.7, 1] as const,
  // QA N121-4: white 17 px team name needs 4.5:1 at the top stop under the 6 % highlight (4.80)
  // 1.3.2 (live match v2): the Team A dark red is #B92A2A.
  teamA: ['#C93434', '#B92A2A'] as const,
  teamB: ['#0A2F66', '#001F4D'] as const,
  /** Player chips on the live court (§11.2): white text ≥ 4.5:1 on both stops. */
  chipA: ['#D93636', '#B92A2A'] as const,
  chipB: ['#0F3A78', '#001F4D'] as const,
  progress: ['#0072BC', '#00BAF2'] as const,
  gold: ['#FFD75E', '#F2B300'] as const,
  silver: ['#C9D3DF', '#9FB0C4'] as const,
  bronze: ['#F1B88C', '#D98A4E'] as const,
  rankCard: ['#E6F7FD', '#FFFFFF'] as const,
  potm: ['#FFF6D6', '#FFFFFF'] as const,
};

export const colors = {
  /** Main buttons, Add/Start, highlights, serve pill, active tab. Text on it: `onPrimary` (navy). */
  primary: palette.blue,
  onPrimary: palette.navy,
  /** Blue text, links, icons and selection borders on white / the light background. */
  primaryText: palette.blueText,
  /** Headers, tab bar, dark cards and buttons. Text on it: `onInk` / `onInkMuted` / `primary`. */
  ink: palette.navy,
  /** Raised controls on dark surfaces (score screen buttons, chips). */
  ink2: palette.navy2,
  /** Selected item on a dark surface. */
  inkSelected: palette.navySelected,
  onInk: palette.white,
  /**
   * Muted text on navy and the hero gradient (QA N121-5, 1.3.1): ≥ 4.5:1 on every hero stop, and still
   * ≥ 4.5:1 inside a 14 % white glass chip on the lightest stop #0A56B5 (6.2 bare, 4.56 in a chip).
   * The old #B8C7DC was 4.07 there. contrast.test.ts checks every gradient that carries this text.
   */
  onInkMuted: '#EDF2F9',
  bg: palette.bg,
  card: palette.white,
  /** Light panels (court diagrams, info banners) on white. */
  surface: palette.bg,
  /** Primary text on light backgrounds is navy (13:1 on white). */
  text: palette.navy,
  muted: palette.grey700,
  /** Placeholder text: AA on white, bg and tint (Tester 1.2.0). */
  placeholder: palette.grey650,
  /** Input / control borders: ≥ 3:1 on white, bg and tint (Tester 1.2.0: #D8DFE9 was 1.3:1). */
  border: palette.grey500,
  /** Decorative card hairlines (not a control boundary). */
  hairline: palette.grey200,
  divider: palette.grey100,
  /** Inactive tab icons/labels on the navy tab bar. */
  tabInactive: palette.grey400,
  /** Bright red: fills and large text only; small text on it uses onColor() (Tester 1.2.0). */
  red: palette.red,
  gold: palette.gold,
  goldText: palette.goldText,
  goldTint: palette.goldTint,
  lossText: palette.lossText,
  lossBg: palette.lossBg,
  successStrong: palette.successStrong,
  successBg: palette.successBg,
  court: palette.court,
  blueLine: palette.blueLine,
  /** Error text and destructive buttons (AA for small text on white). */
  danger: palette.redDark,
  /** Live badge fill (white 11px text on it needs the darker red for AA). */
  live: palette.redDark,
  /** Success text / icons on white (AA). */
  success: palette.green,
  /** Success fills (badges, dots) – carry navy text. */
  successFill: palette.greenFill,
  warnBg: palette.blueTint,
  selectedBg: palette.blueTint,
  tint: palette.blueTint,
  white: palette.white,
  /** Disabled buttons: solid light grey with dark grey text, not a faded colour. */
  disabledBg: '#E1E6EE',
  disabledText: palette.grey700,
  /** Default team colours: Team A red, Team B deep navy (3.48:1 from red). */
  teamA: palette.teamRed,
  teamB: palette.navyDeep,
  /** Map. */
  mapBg: '#DCEBDD',
  mapRoad: palette.white,
  mapRoadMajor: '#D6E4F2',
  mapTournament: palette.purple,
  /** "You are here" dot: navy with a light-blue halo. */
  userDot: palette.navy,
  userHalo: 'rgba(0,186,242,0.30)',
  /** Overlays. */
  scrim: 'rgba(0,31,77,0.55)',
  scrimLight: 'rgba(0,31,77,0.25)',
  toast: 'rgba(0,31,77,0.94)',
  /** Darkening layer behind small white text on a team-colour panel (keeps AA on light team colours). */
  onTeamScrim: 'rgba(0,0,0,0.3)',
} as const;

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Text colour for content on an arbitrary fill (e.g. a user-picked team colour): white when it
 * reaches AA, otherwise black when that does, otherwise whichever is higher.
 */
export function onColor(bg: string): string {
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(bg)) return colors.white;
  const w = contrast(bg, colors.white);
  const k = contrast(bg, colors.ink);
  if (w >= 4.5) return colors.white;
  if (k >= 4.5) return colors.ink;
  return w >= k ? colors.white : colors.ink;
}

/**
 * Everything drawn on a user-picked team colour: text colour from onColor() (black or white, AA),
 * a translucent pill behind small text that darkens (white text) or lightens (black text) the
 * fill, and a text shadow only when the text is white.
 */
export function teamInk(bg: string): { fg: string; scrim: string; shadow: string; outline: string } {
  const fg = onColor(bg);
  const dark = fg === colors.white;
  return {
    fg,
    scrim: dark ? colors.onTeamScrim : 'rgba(255,255,255,0.45)',
    shadow: dark ? 'rgba(0,0,0,0.35)' : 'transparent',
    outline: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
  };
}

/**
 * Colours of the SERVING pill on a team half: light blue with navy text (5.76:1) and a 2 px ring.
 * The ring is what separates the pill from the team colour, so it is the team's onColor() (white on
 * dark teams, navy on light ones), which always reaches 3:1 against the fill (Tester 1.2.0: the blue
 * pill alone was 2.05:1 on Team A red).
 */
export function servePill(teamColor: string): { bg: string; fg: string; border: string } {
  const valid = /^#[0-9a-f]{6}$/i.test(teamColor);
  if (!valid) return { bg: colors.primary, fg: colors.onPrimary, border: colors.white };
  return { bg: colors.primary, fg: colors.onPrimary, border: onColor(teamColor) };
}

/**
 * Ring around a team-colour panel that sits next to the navy chrome: a team colour within 3:1 of
 * navy (e.g. the default Team B #001F4D, 1.24:1) gets a light-blue 2 px ring (8.45:1 on navy), so it
 * never blends into the header or tab bar (Tester 1.2.0). Null when no ring is needed.
 */
export function teamRing(teamColor: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(teamColor)) return null;
  return contrast(teamColor, colors.ink) < 3 ? palette.blueLine : null;
}

/**
 * QA B121-6: the ring for a team-colour dot, badge or swatch on any background. A colour close to the
 * navy chrome/text (e.g. Team B #001F4D) gets the light-blue ring so it reads as a team colour
 * and not as a navy bullet; a colour that is faint on the light page (< 3:1 on white) gets a muted ring.
 */
export function swatchRing(teamColor: string, width = 2): { borderWidth: number; borderColor: string } | null {
  if (!/^#[0-9a-f]{6}$/i.test(teamColor)) return null;
  // near-navy (within 1.5:1 of the navy chrome/text, e.g. #001F4D at 1.24:1) -> light-blue ring
  if (contrast(teamColor, colors.ink) < 1.5) return { borderWidth: width, borderColor: palette.blueLine };
  if (contrast(teamColor, colors.white) < 3) return { borderWidth: width, borderColor: colors.muted };
  return null;
}

/** Hex of `hex` with `alpha` of white laid over it (the score half's top highlight). */
export function overWhite(hex: string, alpha: number): string {
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - alpha) + 255 * alpha).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** The 6 % white highlight drawn over the top of a score half (LiveScoring s.highlight). */
export const TEAM_HIGHLIGHT_ALPHA = 0.06;

/**
 * Two-stop gradient for a team half: the defaults use the spec's stops, custom colours lighten 6% →
 * darken 8%. QA N121-4 / N121-7: when the half carries WHITE text (the 17 px team name is not "large"
 * text), both stops are darkened until white reaches 4.5:1 on the lightest point (the top stop under
 * the 6 % highlight). A legacy #E53935 custom team is darkened the same way.
 */
/** Live court chip gradient (§11.2): the spec stops for the defaults, teamGradient for custom colours. */
export function chipGradient(teamColor: string): [string, string] {
  const c = teamColor.toUpperCase();
  if (c === palette.teamRed) return [...gradients.chipA];
  if (c === palette.navyDeep) return [...gradients.chipB];
  return teamGradient(teamColor);
}

export function teamGradient(teamColor: string): [string, string] {
  const c = teamColor.toUpperCase();
  if (c === palette.teamRed) return [...gradients.teamA];
  if (c === palette.navyDeep) return [...gradients.teamB];
  if (!/^#[0-9A-F]{6}$/.test(c)) return [teamColor, teamColor];
  const ch = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (k: number, base = ch) => '#' + base.map((v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))).toString(16).padStart(2, '0')).join('').toUpperCase();
  let top = mix(0.06);
  let bottom = mix(-0.08);
  if (onColor(c) === colors.white) {
    for (let i = 0; i < 20 && contrast(overWhite(top, TEAM_HIGHLIGHT_ALPHA), colors.white) < 4.5; i++) {
      top = mix(-0.04, [1, 3, 5].map((j) => parseInt(top.slice(j, j + 2), 16)));
      bottom = mix(-0.04, [1, 3, 5].map((j) => parseInt(bottom.slice(j, j + 2), 16)));
    }
  }
  return [top, bottom];
}

/**
 * A team colour used as TEXT on a light background: the colour itself when it already reaches
 * `min` against `bg`, otherwise the same hue darkened just enough (e.g. yellow or light team names/numbers).
 */
export function teamText(color: string, bg: string = colors.white, min = 4.5): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return colors.text;
  if (contrast(color, bg) >= min) return color;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let k = 0.95; k > 0; k -= 0.05) {
    const hex = '#' + [r, g, b].map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
    if (contrast(hex, bg) >= min) return hex.toUpperCase();
  }
  return colors.text;
}

/**
 * A fill that some text can sit on at AA: the colour itself when white or black reaches 4.5:1,
 * otherwise darkened just until white does (e.g. a team saved with the older #E53935 red, where
 * white is 4.2:1 and black 4.5-:1). Used behind avatar initials.
 */
export function readableFill(bg: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(bg)) return bg;
  if (Math.max(contrast(bg, colors.white), contrast(bg, colors.ink)) >= 4.5) return bg;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  for (let k = 0.97; k > 0; k -= 0.03) {
    const hex = '#' + [r, g, b].map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
    if (contrast(hex, colors.white) >= 4.5) return hex.toUpperCase();
  }
  return colors.ink;
}

export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };

/** design-spec §4 elevation. */
export const elevation = {
  e1: { shadowColor: '#002E6E', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  e2: { shadowColor: '#002E6E', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  e3: { shadowColor: '#002E6E', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  glowPrimary: { shadowColor: '#00BAF2', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  barTop: { shadowColor: '#002E6E', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
} as const;

/** design-spec §3 type scale (numbers that change use tabular digits). */
export const type = {
  score: { fontSize: 104, lineHeight: 108, fontWeight: '900' as const, letterSpacing: -3, fontVariant: ['tabular-nums' as const] },
  rank: { fontSize: 44, lineHeight: 46, fontWeight: '900' as const, letterSpacing: -1 },
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.4 },
  h1: { fontSize: 22, lineHeight: 28, fontWeight: '800' as const },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: '700' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  tab: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '700' as const },
};
/** Overline text: no letterSpacing / uppercase on Devanagari (breaks conjuncts, design-spec §3). */
export const overlineFor = (lang: string) => (lang === 'hi' ? { fontSize: 12, lineHeight: 16, fontWeight: '700' as const } : type.overline);

/** Soft card shadow (elevation on Android). */
export const shadow = {
  shadowColor: '#002E6E',
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;
export const space = (n: number) => n * 4;

export const font = {
  h1: { fontSize: 30, fontWeight: '900' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '800' as const },
  h3: { fontSize: 17, fontWeight: '800' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 13, fontWeight: '600' as const },
};
