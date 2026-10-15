import fs from 'fs';
import path from 'path';
import { TEAM_COLORS } from '../../core/types';
import { NAVY_LIVE, colors, contrast, onColor, palette, readableFill, servePill, teamInk, teamRing, teamText } from '../index';
import { tabBarMetrics } from '../tabBar';

const AA = 4.5; // normal text
const AA_LARGE = 3; // large text (>= 24px, or >= 18.66px bold) and UI components

/** [foreground, background, minimum, where it is used] */
const PAIRS: [string, string, number, string][] = [
  [colors.text, colors.bg, AA, 'body text on white'],
  [colors.text, colors.card, AA, 'text on cards'],
  [colors.muted, colors.bg, AA, 'secondary text on white'],
  [colors.muted, colors.surface, AA, 'secondary text on grey panels'],
  [colors.placeholder, colors.white, AA, 'input placeholders'],
  [colors.onPrimary, colors.primary, AA, 'navy text on light-blue buttons'],
  [colors.primaryText, colors.bg, AA, 'blue links/text on light background'],
  [colors.primaryText, colors.warnBg, AA, 'blue text on tint banner'],
  [colors.text, colors.warnBg, AA, 'warning banner text'],
  [colors.danger, colors.bg, AA, 'small error text on white'],
  [colors.danger, colors.warnBg, AA, 'error text on warning banner'],
  [colors.white, colors.danger, AA, 'white text on destructive buttons / error bar'],
  [colors.white, colors.live, AA, 'live badge'],
  [colors.success, colors.bg, AA, 'success text'],
  [colors.onInk, colors.ink, AA, 'white text on navy header / tab bar'],
  [colors.onInkMuted, colors.ink, AA, 'muted text on navy'],
  [colors.primary, colors.ink, AA, 'light-blue text on navy (score header, active tab)'],
  [colors.tabInactive, colors.ink, AA, 'inactive tab label'],
  [colors.onInk, colors.ink2, AA, 'white text on navy controls'],
  [colors.primary, colors.ink2, AA, 'light-blue text on navy controls'],
  [colors.onInk, colors.inkSelected, AA, 'selected player on dark'],
  [colors.red, colors.bg, AA_LARGE, 'bright red only as large text / fills on white'],
  [colors.primary, colors.inkSelected, AA_LARGE, 'light-blue selection border on dark'],
  [colors.primaryText, colors.bg, AA_LARGE, 'selection borders on white'],
  [colors.white, colors.teamA, AA_LARGE, 'large score / team name on Team A red'],
  [colors.white, colors.teamB, AA, 'text on Team B navy'],
  [colors.teamA, colors.teamB, AA_LARGE, 'Team A vs Team B colours are distinct'],
  [colors.disabledText, colors.disabledBg, AA, 'disabled button text on grey'],
  [colors.primaryText, colors.white, AA_LARGE, 'blue card borders on white (home invites/challenges)'],
  [colors.onPrimary, colors.primary, AA, 'SERVING pill text'],
  [colors.text, colors.tint, AA, 'navy text on tint chips / selected states'],
  [colors.primaryText, colors.tint, AA, 'blue text on tint chips'],
  [colors.primaryText, colors.white, AA, 'blue links on white cards'],
  [colors.text, colors.surface, AA, 'navy text on the #F5F7FA background'],
  [colors.onPrimary, colors.successFill, AA, 'navy text on success fills'],
  [colors.white, colors.teamB, AA, 'white text on Team B navy'],
  [colors.primary, colors.ink, AA_LARGE, 'active tab icon on navy tab bar'],
  [colors.primary, colors.bg, 0, 'light blue is never text on white (documented, fills only)'],
];

describe('theme contrast (WCAG AA)', () => {
  test.each(PAIRS)('%s on %s ≥ %s (%s)', (fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  test('known reference ratios', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast(palette.white, palette.blue)).toBeLessThan(3); // why light-blue buttons use navy text
    expect(contrast(palette.navy, palette.teamRed)).toBeLessThan(3); // why Team B is the deeper navy
    expect(contrast(palette.greenFill, palette.white)).toBeLessThan(AA); // why success text uses the darker green
    expect(contrast(palette.red, palette.white)).toBeLessThan(AA); // why small error text uses redDark
    expect(contrast(palette.white, palette.teamRed)).toBeGreaterThanOrEqual(AA); // Team A red carries white text
  });

  test('onColor picks readable text for every team colour', () => {
    for (const c of TEAM_COLORS) expect(contrast(onColor(c), c)).toBeGreaterThanOrEqual(AA);
    expect(onColor(colors.primary)).toBe(colors.ink);
    expect(onColor(colors.teamB)).toBe(colors.white);
  });

  test('team defaults: A is red, B is charcoal', () => {
    expect(TEAM_COLORS[0]).toBe(colors.teamA);
    expect(TEAM_COLORS[1]).toBe(colors.teamB);
  });

  test('no old navy/yellow or orange theme colours left in theme, app config or source', () => {
    const OLD = /#0B1F3A|#13305A|#FFC400|#1E3A66|#C9D3E6|#9FB0CC|rgba\(11,\s*31,\s*58/i;
    expect(JSON.stringify(colors)).not.toMatch(OLD);
    const root = path.resolve(__dirname, '../../..');
    const cfg = fs.readFileSync(path.join(root, 'app.config.ts'), 'utf8');
    expect(cfg).not.toMatch(OLD);
    expect(cfg).toContain(`backgroundColor: '${palette.navy}'`);
    expect(cfg).toContain(`color: '${palette.blue}'`);
    expect(cfg).toContain(`primaryColor: '${palette.navy}'`);
    expect(JSON.stringify(colors)).not.toMatch(/#FF6B00|#C2410C|#FFF3E0/i);
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
    const offenders = walk(path.join(root, 'src')).filter((f) => /\.tsx?$/.test(f) && OLD.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('threshold is exactly WCAG AA 4.5', () => expect(AA).toBe(4.5));

  describe.each(TEAM_COLORS.map((c) => [c]))('team colour preset %s', (c) => {
    test('onColor text ≥ 4.5', () => expect(contrast(onColor(c), c)).toBeGreaterThanOrEqual(AA));
    test('avatar initials ≥ 4.5', () => expect(contrast(teamInk(c).fg, c)).toBeGreaterThanOrEqual(AA));
    test('SERVING pill: text ≥ 4.5 on the pill, pill ≥ 3:1 against the team half (or outlined)', () => {
      const p = servePill(c);
      expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(AA);
      expect(Math.max(contrast(p.bg, c), contrast(p.border, c))).toBeGreaterThanOrEqual(AA_LARGE);
    });
    test('as text on white (stats numbers, lineup names) ≥ 4.5', () => expect(contrast(teamText(c), colors.white)).toBeGreaterThanOrEqual(AA));
  });

  test('avatar initials on red reach 4.5 (also on a team saved with the older #E53935)', () => {
    expect(onColor(colors.teamA)).toBe(colors.white);
    expect(contrast(onColor(colors.teamA), colors.teamA)).toBeGreaterThanOrEqual(AA);
    const fill = readableFill('#E53935');
    expect(contrast(onColor(fill), fill)).toBeGreaterThanOrEqual(AA);
    for (const c of TEAM_COLORS) expect(readableFill(c)).toBe(c); // presets are used as-is
  });

  test('serve pill (redesign): light-blue pill, navy text, ring in the team onColor so it is ≥3:1 from ANY team colour', () => {
    expect(servePill('#00A0E0')).toEqual({ bg: colors.primary, fg: colors.onPrimary, border: colors.ink });
    expect(servePill(colors.teamA)).toEqual({ bg: colors.primary, fg: colors.onPrimary, border: colors.white });
    expect(servePill(colors.teamB)).toEqual({ bg: colors.primary, fg: colors.onPrimary, border: colors.white });
    expect(servePill('not-a-colour').border).toBe(colors.white);
    // sweep: every 0x33-step colour gets a pill that stands out (pill or ring ≥ 3:1 against the team)
    const hex = ['00', '33', '66', '99', 'CC', 'FF'];
    for (const r of hex) for (const g of hex) for (const b of hex) {
      const c = `#${r}${g}${b}`;
      const p = servePill(c);
      expect(Math.max(contrast(p.bg, c), contrast(p.border, c))).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  test('Tester 1.2.0: input border ≥ 3:1 on white, bg and tint; placeholder ≥ 4.5 on bg and tint', () => {
    for (const bg of [colors.white, colors.bg, colors.tint]) expect(contrast(colors.border, bg)).toBeGreaterThanOrEqual(AA_LARGE);
    for (const bg of [colors.white, colors.bg, colors.tint]) expect(contrast(colors.placeholder, bg)).toBeGreaterThanOrEqual(AA);
  });

  test('Tester 1.2.0: default Team B gets a ring so it never blends into the navy chrome, and stays ≥3:1 from Team A', () => {
    expect(contrast(colors.teamB, colors.ink)).toBeLessThan(AA_LARGE);
    const ring = teamRing(colors.teamB);
    expect(ring).toBeTruthy();
    expect(contrast(ring as string, colors.ink)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(teamRing(colors.primary)).toBeNull(); // light colours already stand out on navy
    expect(contrast(colors.teamA, colors.teamB)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  test('Tester 1.2.0: text on the legacy #E53935 uses onColor or the darker red', () => {
    expect(contrast(colors.white, '#E53935')).toBeLessThan(AA);
    const fill = readableFill('#E53935');
    expect(contrast(onColor(fill), fill)).toBeGreaterThanOrEqual(AA);
    expect(contrast(teamText('#E53935'), colors.white)).toBeGreaterThanOrEqual(AA);
  });

  test('redesign tokens: gold badge, loss/success chips, LIVE pill, hairlines', () => {
    expect(contrast(colors.goldText, colors.goldTint)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.lossText, colors.lossBg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.successStrong, colors.successBg)).toBeGreaterThanOrEqual(AA);
    expect(contrast(colors.white, colors.live)).toBeGreaterThanOrEqual(AA);
  });

  test('no stale "orange" comments in theme or scoring components', () => {
    const root = path.resolve(__dirname, '../..');
    for (const f of ['theme/index.ts', 'components/MiniCourt.tsx', 'components/LineupPicker.tsx', 'components/LiveScoring.tsx', 'app/match/[id]/score.tsx'])
      expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toMatch(/orange/i);
  });

  test('no screen puts hard-coded white text on a team colour any more', () => {
    const root = path.resolve(__dirname, '../..');
    const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    expect(read('app/team/[id].tsx')).not.toMatch(/backgroundColor: team\.color[\s\S]{0,200}color: colors\.white/);
    expect(read('components/LineupPicker.tsx')).toContain('color: onColor(team.color)');
    const score = read('app/match/[id]/score.tsx');
    expect(score).toContain('<TeamHalf');
    const live = read('components/LiveScoring.tsx');
    // 1.4.22 (spec v2 *-02): the halves use the side tokens with their AA "on" colours; the team's own colour is only a dot
    expect(live).not.toMatch(/backgroundColor: p\.color[\s\S]{0,200}color: colors\.white/);
    expect(live).toContain('tk.onTeamB');
    expect(read('components/ui.tsx')).toContain('color: onColor(fill)');
  });

  test('home invite/challenge cards use the dark blue border (≥ 3:1)', () => {
    const home = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/index.tsx'), 'utf8');
    expect(home).not.toContain('borderColor: colors.primary,');
    expect(home).toContain('borderColor: colors.primaryText, borderWidth: 2');
  });

  test('V1: no blue left in the theme', () => {
    const BLUE = /#(1565C0|2563EB|1E88E5|2196F3|1D4ED8|3B82F6)/i;
    expect(JSON.stringify(colors)).not.toMatch(BLUE);
    expect(JSON.stringify(palette)).not.toMatch(BLUE);
    expect(TEAM_COLORS.join()).not.toMatch(BLUE);
  });

  test('V2: tab labels get two lines and a taller line for Devanagari', () => {
    const en = tabBarMetrics('en', 0);
    const hi = tabBarMetrics('hi', 0);
    expect(hi.lineHeight).toBeGreaterThanOrEqual(hi.fontSize * 1.5);
    expect(en.height).toBeGreaterThanOrEqual(6 + 24 + 2 + en.lineHeight * 2 + 6);
    expect(hi.height).toBeGreaterThan(en.height);
    expect(tabBarMetrics('hi', 24).paddingBottom).toBe(30);
    expect(tabBarMetrics('en', 0, 360).fontSize).toBeLessThan(tabBarMetrics('en', 0, 412).fontSize);
  });
});

/** Composite `fg` at `alpha` over `bg` (both #RRGGBB). */
const mix = (bg: string, fg: string, alpha: number) => {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(ch(bg, i) * (1 - alpha) + ch(fg, i) * alpha).toString(16).padStart(2, '0')).join('');
};

describe('QA N121-5 (1.3.1): muted 12 px text on every hero gradient', () => {
  const { gradients } = require('../index') as typeof import('../index');
  // Every gradient that carries onInkMuted text: HeroHeader (home, profile, wallet, tournament), the
  // rankings hero (rankings.tsx), the match summary hero (match/[id]/index.tsx), plus the navy surfaces.
  const HERO_BACKGROUNDS: [string, string][] = [
    ...gradients.hero.map((c, i) => [c, `gradients.hero stop ${i}`] as [string, string]),
    [colors.ink, 'navy header / tab bar'],
    [colors.ink2, 'navy controls'],
  ];
  test.each(HERO_BACKGROUNDS)('onInkMuted on %s (%s) ≥ 4.5', (bg) => {
    expect(contrast(colors.onInkMuted, bg)).toBeGreaterThanOrEqual(AA);
  });
  test.each([0.12, 0.14])('…and inside a %s white glass chip on every hero stop', (a) => {
    for (const stop of gradients.hero) expect(contrast(colors.onInkMuted, mix(stop, '#FFFFFF', a))).toBeGreaterThanOrEqual(AA);
  });
  test('the QA reference: old #B8C7DC failed on #0A56B5 (≈4.07), the new colour clears it with margin', () => {
    expect(contrast('#B8C7DC', '#0A56B5')).toBeLessThan(AA);
    expect(contrast(NAVY_LIVE.onInkMuted, '#0A56B5')).toBeGreaterThanOrEqual(6); // 1.4.21: Navy Live reference; live themes: themes1421.test.ts
  });
  test('every hero gradient file uses gradients.hero (so the checks above cover it)', () => {
    const root = path.resolve(__dirname, '../..');
    for (const f of ['components/Hero.tsx', 'app/rankings.tsx', 'app/match/[id]/index.tsx', 'app/wallet.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).toMatch(/gradients\.hero/);
      expect(src).not.toMatch(/colors=\{\[\s*'#/); // no ad-hoc hero colours
    }
  });
});

describe('QA C130-6 (1.3.1): demo photo captions are readable on every scene', () => {
  const { DEMO_SCENES, DEMO_CAPTION, demoPhotoUrl } = require('../../services/backend/demoSeed') as typeof import('../../services/backend/demoSeed');
  test.each(DEMO_SCENES.map((x) => [x[2], x[0]]))('%s: caption on its scrim ≥ 4.5 (scene %s)', (_name, bg) => {
    expect(contrast(DEMO_CAPTION.fg, mix(bg, DEMO_CAPTION.scrim, DEMO_CAPTION.scrimOpacity))).toBeGreaterThanOrEqual(AA);
  });
  test('the caption sits inside the scrim band with room above tall Devanagari marks', () => {
    const svg = decodeURIComponent(demoPhotoUrl(2, 'hi').split(',')[1]);
    expect(svg).toContain(`fill-opacity="${DEMO_CAPTION.scrimOpacity}"`);
    expect(svg).toContain('टीम मीटिंग');
    expect(svg).toMatch(new RegExp(`<text x="320" y="${DEMO_CAPTION.baseline}"[^>]*fill="${DEMO_CAPTION.fg}"`));
    const ascent = 44; // font-size: matras and "!" reach about one em above the baseline
    expect(DEMO_CAPTION.baseline - ascent - DEMO_CAPTION.bandY).toBeGreaterThanOrEqual(16); // top padding
    expect(DEMO_CAPTION.baseline + 14).toBeLessThanOrEqual(DEMO_CAPTION.bandY + DEMO_CAPTION.bandH); // descenders inside
  });
});
