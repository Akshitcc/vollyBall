# VolleyLive: Phase-2 Design Spec ("Navy Live")

Version 2.0 · 11 Oct 2026 · for the React Native / Expo app (`expo ~57`, RN 0.86, EN + HI)
Mockups: `/workspace/volleylive-design/*.png` (360×800 dp, rendered @2x = 720×1600 px). HTML sources: `src/`. Re-render: `./render.sh` (all) or `./render.sh 02-live-scoring` (one). Contrast check: `python3 contrast_check.py`.
All names, scores and phone numbers in the mockups are **sample data**.

Phase 2 builds on the phase-1 re-theme already in `src/theme/index.ts` (navy `#002E6E`, light blue `#00BAF2`, bg `#F5F7FA`, white 16-radius cards, navy-on-light-blue buttons, home quick-action grid, `PressableScale`). Every token below either matches an existing `palette`/`colors` key or is listed as **NEW**.

## 0. Design direction (one paragraph)

Paytm-style "fintech-clean": a **navy gradient header that the first white card overlaps** (–48 dp), a 4-column grid of **light-blue rounded icon tiles**, lots of white cards on a cool grey background, and **one light-blue primary action per screen** with navy text. Data is the hero: big tabular numbers (score 104, rank 44, stats 17–20), small grey labels. Interactivity is shown through motion and haptics: every tap squishes, every point "pops" (+1 bubble, number roll, haptic), and sheets slide up instead of new screens. The live scorer stays **light** (works in sunlight) with two saturated team panels as giant tap targets.

## 1. Screens delivered

| File | Screen | Notes |
|---|---|---|
| `01-home.png` | Home | Navy hero + search, overlapping 8-tile quick actions, rank progress card, live carousel, upcoming |
| `02-live-scoring.png` | Live scoring (resting) | Team halves 164×288, set strip, LIVE camera button, last-rally ticker, court & rotation, Undo bar |
| `02b-live-scoring-tap.png` | Live scoring (after tap) | Press/+1/ripple state and the "Who scored?" sheet; yellow dashed boxes are **annotations, not UI** |
| `03-profile.png` | Profile | Avatar ring (= progress to next rank), Rank #3 hero card, KPI tiles, form chips, career stats, teams |
| `04a-login.png` | Login | Language switch, +91 phone field (focused), disabled → enabled CTA, value props |
| `04b-otp.png` | OTP | 6 boxes with focus ring, SMS auto-read state, resend countdown |
| `05-new-match.png` | New match · Step 1 Teams | Stepper, segmented "Registered team / Add by number", colour swatches, 5/12 meter, found-player card with jersey # |
| `06-match-summary.png` | Match summary | Winner hero + confetti, set scores, Player of the Match card, Photos tab grid, share bar |
| `07-rankings.png` | Rankings | Filter chips, podium (gold/silver/bronze), list with trend arrows, sticky "You" bar |
| `08a-home-empty.png` | Home · new user | No live matches + "Get your first rank" checklist |
| `08b-rankings-empty.png` | Rankings · not enough matches | Empty podium + 1/3 progress ring |
| `09-home-loading.png` | Home · skeleton | Shimmer placeholders |
| `10-live-scoring-hi.png` | Live scoring · Hindi | Proves Devanagari fits (strings from `locales/hi.ts`) |
| `00-overview.png` | Contact sheet of all screens | |

## 2. Colour tokens

```ts
// src/theme/index.ts – additions marked NEW, everything else already exists
export const palette = {
  navy: '#002E6E', navyDeep: '#001F4D', navy2: '#083777', navySelected: '#1A4F96',
  navyMid: '#003B8C',      // NEW – hero gradient middle stop
  navyBright: '#0A56B5',   // NEW – hero gradient end stop (white text 6.97:1)
  blue: '#00BAF2', blueText: '#0072BC', blueTint: '#E6F7FD',
  blueLine: '#9ED9F2',     // NEW – focus-ish borders on tint, court lines
  court: '#DDF2FB',        // NEW – court diagram fill
  white: '#FFFFFF', bg: '#F5F7FA',
  grey100: '#EDF1F6', grey200: '#D8DFE9', grey400: '#9FB3CF', grey600: '#6B778A', grey700: '#4D5B70',
  teamRed: '#D93636', redDark: '#C62828',
  lossText: '#B42318', lossBg: '#FDE2E2',          // NEW – L chips, "1 more to start"
  green: '#15803D', greenFill: '#21C17A',
  successStrong: '#166534', successBg: '#DCF5E7',  // NEW – rank-up pill
  syncIcon: '#5FD49B',                             // NEW – synced cloud icon on navy only
  gold: '#FFC727', goldText: '#8A5A00', goldTint: '#FFF6D6', // NEW – POTM, #1, WINNER
  silver: '#C9D3DF', silverDark: '#9FB0C4',        // NEW – #2 podium
  bronze: '#E8A06A', bronzeDark: '#D98A4E',        // NEW – #3 podium
} as const;

export const gradients = { // NEW – use with expo-linear-gradient (start {x:0,y:0} end {x:0.35,y:1})
  hero: ['#002E6E', '#003B8C', '#0A56B5'],          // locations [0, 0.7, 1]
  teamA: ['#E24545', '#C42C2C'],                     // derive for custom team colours: lighten 6% → darken 8%
  teamB: ['#0A2F66', '#001F4D'],
  progress: ['#0072BC', '#00BAF2'],                  // horizontal
  gold: ['#FFD75E', '#F2B300'], silver: ['#C9D3DF', '#9FB0C4'], bronze: ['#F1B88C', '#D98A4E'],
};
```
If `expo-linear-gradient` is not added, use the flat fallback `navy` for hero and the team colour for halves; the layout does not depend on gradients.

### Usage rules
- **Primary action** = `blue` fill + `navy` label. Never white on light blue (2.26:1, fails).
- **Navy** is text colour on light surfaces and the fill for header, tab bar, secondary "ink" buttons, sticky You bar.
- **Links / blue text** on light surfaces = `blueText #0072BC` (≥4.6:1 on white, bg and tint).
- Gold is reserved for **achievement** (POTM, #1, WINNER); gold *text* is `goldText`.
- Team colours: keep `teamInk()`/`servePill()`/`teamText()` helpers; they already guarantee AA on custom colours.

### Contrast (WCAG 2.1 AA, computed by `contrast_check.py`)
Normal text ≥ 4.5:1; large text (≥ 18.66 px bold / 24 px) and UI glyphs ≥ 3:1.

| Pair (fg on bg) | Use | Ratio | AA |
|---|---|---|---|
| `#002E6E` on `#FFFFFF` | Body text (navy) on card | 13.00:1 | PASS (≥4.5) |
| `#002E6E` on `#F5F7FA` | Body text on app background | 12.11:1 | PASS (≥4.5) |
| `#002E6E` on `#00BAF2` | Primary button label (navy on light blue) | 5.76:1 | PASS (≥4.5) |
| `#002E6E` on `#E6F7FD` | Navy icon/text on tint tile | 11.81:1 | PASS (≥4.5) |
| `#FFFFFF` on `#002E6E` | White text on navy header/tab bar | 13.00:1 | PASS (≥4.5) |
| `#FFFFFF` on `#0A56B5` | White text on hero gradient light end | 6.97:1 | PASS (≥4.5) |
| `#B8C7DC` on `#002E6E` | Muted text on navy | 7.58:1 | PASS (≥4.5) |
| `#B8C7DC` on `#003B8C` | Muted text on hero gradient mid | 6.11:1 | PASS (≥4.5) |
| `#9FB3CF` on `#002E6E` | Inactive tab label on navy | 6.08:1 | PASS (≥4.5) |
| `#00BAF2` on `#002E6E` | Light-blue icon / #rank text on navy | 5.76:1 | PASS (≥3.0) |
| `#0072BC` on `#FFFFFF` | Link / blue text on white | 5.08:1 | PASS (≥4.5) |
| `#0072BC` on `#F5F7FA` | Link on background | 4.73:1 | PASS (≥4.5) |
| `#0072BC` on `#E6F7FD` | Blue text on tint (selected) | 4.62:1 | PASS (≥4.5) |
| `#4D5B70` on `#FFFFFF` | Secondary text on white | 6.89:1 | PASS (≥4.5) |
| `#4D5B70` on `#F5F7FA` | Secondary text on background | 6.42:1 | PASS (≥4.5) |
| `#6B778A` on `#FFFFFF` | Placeholder text on white | 4.53:1 | PASS (≥4.5) |
| `#4D5B70` on `#E1E6EE` | Disabled button label | 5.50:1 | PASS (≥4.5) |
| `#FFFFFF` on `#D93636` | White on Team A red (team name, 13px jersey) | 4.63:1 | PASS (≥4.5) |
| `#FFFFFF` on `#C42C2C` | White on Team A gradient dark end | 5.61:1 | PASS (≥4.5) |
| `#FFFFFF` on `#001F4D` | White on Team B navy | 16.11:1 | PASS (≥4.5) |
| `#D93636` on `#001F4D` | Team A vs Team B fills (adjacent halves) | 3.48:1 | PASS (≥3.0) |
| `#002E6E` on `#00BAF2` | SERVING pill (navy on blue) - also has white 2px ring | 5.76:1 | PASS (≥4.5) |
| `#FFFFFF` on `#C62828` | LIVE badge / camera button | 5.62:1 | PASS (≥4.5) |
| `#15803D` on `#FFFFFF` | Success text on white | 5.02:1 | PASS (≥4.5) |
| `#FFFFFF` on `#15803D` | W form chip / done step | 5.02:1 | PASS (≥4.5) |
| `#B42318` on `#FFFFFF` | Error / loss text on white | 6.57:1 | PASS (≥4.5) |
| `#B42318` on `#FDE2E2` | L form chip | 5.37:1 | PASS (≥4.5) |
| `#166534` on `#DCF5E7` | Rank-up pill (successStrong) | 6.20:1 | PASS (≥4.5) |
| `#15803D` on `#E6F7FD` | Rank trend text on home rank card (tint end) | 4.56:1 | PASS (≥4.5) |
| `#5FD49B` on `#002E6E` | Synced cloud icon on navy | 7.04:1 | PASS (≥3.0) |
| `#FFFFFF` on `#0072BC` | White initials on blue avatar | 5.08:1 | PASS (≥4.5) |
| `#FFFFFF` on `#7C3AED` | White initials on purple avatar | 5.70:1 | PASS (≥4.5) |
| `#FFFFFF` on `#0F7B6C` | White initials on teal avatar | 5.16:1 | PASS (≥4.5) |
| `#FFFFFF` on `#DB2777` | White initials on pink avatar | 4.60:1 | PASS (≥4.5) |
| `#002E6E` on `#F59E0B` | Navy initials on amber avatar | 6.05:1 | PASS (≥4.5) |
| `#8A5A00` on `#FFFFFF` | POTM overline (gold text) on white | 5.93:1 | PASS (≥4.5) |
| `#8A5A00` on `#FFF6D6` | POTM overline on gold-tint end | 5.48:1 | PASS (≥4.5) |
| `#002E6E` on `#FFC727` | WINNER pill / #1 podium | 8.32:1 | PASS (≥4.5) |
| `#002E6E` on `#9FB0C4` | #2 podium numeral (silver, darkest stop) | 5.87:1 | PASS (≥3.0) |
| `#002E6E` on `#D98A4E` | #3 podium numeral (bronze, darkest stop) | 4.76:1 | PASS (≥3.0) |
| `#FFFFFF` on `#A32828` | Timeout chip text on Team A (25% black scrim) | 7.26:1 | PASS (≥4.5) |
| `#FFFFFF` on `#243E66` | Timeout chip text on Team B (14% white) | 10.74:1 | PASS (≥4.5) |
| `#7FDBFA` on `#00529E` | FULL TIME chip text | 4.97:1 | PASS (≥4.5) |
| `#5C4000` on `#FFF4CC` | Design-note annotations (not shipped UI) | 8.71:1 | PASS (≥4.5) |
| `#002E6E` on `#DDF2FB` | Player names on court diagram | 11.24:1 | PASS (≥4.5) |
| `#FFFFFF` on `#00BAF2` | (DONT) white on light blue | 2.26:1 | FAIL (≥4.5) |
All shipped pairs pass; the last row is the documented "don't". The 9 px court position numbers (`#3F6E99` on `court`) are 4.66:1 too, but 9 px is below the 11 px minimum, so treat them as decorative (position is also shown by layout). Bump them to 11 px if they must be readable.

## 3. Typography

System font (Roboto on Android, SF on iOS). Devanagari falls back to Noto Sans Devanagari (Android system font). **Use `fontVariant: ['tabular-nums']` on every number that changes** (scores, timers, points) so digits do not jump.

```ts
export const type = {
  score:   { fontSize: 104, lineHeight: 104, fontWeight: '900', letterSpacing: -3, fontVariant: ['tabular-nums'] }, // live halves
  rank:    { fontSize: 44, lineHeight: 44, fontWeight: '900', letterSpacing: -1 },  // Profile "#3"
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.4 }, // OTP title, big numbers 30–40
  h1:      { fontSize: 22, lineHeight: 28, fontWeight: '800' },  // login welcome, card hero
  h2:      { fontSize: 18, lineHeight: 24, fontWeight: '700' },  // section titles, nav titles
  h3:      { fontSize: 16, lineHeight: 22, fontWeight: '700' },  // card titles, team names
  body:    { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: '700' }, // list primary line
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },  // meta lines, helper text
  overline:{ fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  tab:     { fontSize: 11, lineHeight: 14, fontWeight: '600' },  // minimum size anywhere = 11
  button:  { fontSize: 15, lineHeight: 20, fontWeight: '700' },  // 16/800 for the full-width bottom CTA
} as const;
```
Hindi: do **not** use `letterSpacing` or `textTransform: 'uppercase'` on Devanagari (it breaks conjuncts); add +2 to `lineHeight` for `hi`. `10-live-scoring-hi.png` shows the longest scorer strings fit at these sizes.

## 4. Spacing, radius, elevation

- **Spacing**: 4-pt grid (`space(n) = n*4`). Screen gutter **16**. Card padding **14** (12 for dense lists, 16–20 for hero cards). Gap between cards **12**. Section title: 20 above, 10 below. Bottom bars: 12 top / 16 bottom + safe-area inset.
- **Touch targets** ≥ 48×48 dp (icons are 20–24 but sit in 44–48 hit areas; colour swatches 28 dp use `hitSlop={10}`).

```ts
export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };
// xs: chips-in-cards, jersey squares (10) · sm: inputs, stat tiles · md: cards, icon tiles, buttons (14)
// lg: team halves, tab bar top corners (20) · xl: bottom sheets / login sheet (24–28)

export const elevation = {
  e1: { shadowColor: '#002E6E', shadowOpacity: 0.06, shadowRadius: 6,  shadowOffset: { width: 0, height: 2 },  elevation: 1 }, // ticker, chips
  e2: { shadowColor: '#002E6E', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },  elevation: 3 }, // cards (= existing `shadow`)
  e3: { shadowColor: '#002E6E', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 }, // sticky You bar, FAB, sheets
  glowPrimary: { shadowColor: '#00BAF2', shadowOpacity: 0.40, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }, // primary CTA, FAB, New-match tile
  barTop: { shadowColor: '#002E6E', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: -4 }, elevation: 12 }, // bottom action bars
};
```
Android `elevation` shadows are grey and cannot be tinted on older versions; that is fine. Keep `overflow: 'hidden'` off the element that carries the shadow (wrap content in an inner view).

## 5. Icons

- **One set: Ionicons** from `@expo/vector-icons` (already used across the app and bundled offline). The mockups are drawn with the same Ionicons font, so names below map 1:1.
- Style: **filled** for active/selected states and inside tiles (`home`, `trophy`, `flash`); **outline** for inactive tabs and inline meta (`home-outline`, `location-outline`). Sizes 16 (inline), 20 (buttons), 22 (tabs, nav), 24 (tiles).
- Colour: navy on light, `blue` on navy when active, `#9FB3CF` inactive tab.
- Map: New match `add-circle` · Challenge `flash` · Live `radio` · Tournaments `trophy` · Rankings `podium` · Teams `people` · Courts `location` · Memories `images` · Undo `arrow-undo` · Swap `swap-horizontal` · Stats `stats-chart` · Camera `videocam` · Serve `tennisball` · Timeout `timer-outline` · Sub `swap-vertical` · Spike `flash` · Block `hand-left` · Tip `water` · Opp. error `alert-circle-outline` · Synced `cloud-done` · Language `language-outline`.
- Brand ball: Ionicons has no volleyball; use the custom SVG `src/assets/ball.svg` (render with `react-native-svg`, already an Expo built-in) for the logo and empty-state illustrations only.

## 6. Motion and micro-interactions

Principles: fast (≤ 300 ms for anything blocking), physical (springs for things the finger touched, timing curves for system responses), never block scoring input, and **respect Reduce Motion** (`AccessibilityInfo.isReduceMotionEnabled()` / Reanimated `useReducedMotion()` → swap scale/translate for 150 ms opacity fades; haptics stay).

| Token | Duration | Easing / spring | Used for |
|---|---|---|---|
| `press` | 90 ms in / spring out | `withTiming(0.96)` → `withSpring(1, {damping:14, stiffness:320})` | every Pressable (cards 0.98, tiles/buttons 0.94–0.96, team halves 0.97) |
| `pop` | ~220 ms | `withSpring({damping:12, stiffness:260, mass:0.8})` | score number change, rank badge |
| `float` | 450 ms | `Easing.out(Easing.cubic)` | "+1" bubble: translateY 0→-24, opacity 1→0 (starts at 120 ms) |
| `slide` | 260 ms | `Easing.bezier(0.2, 0, 0, 1)` | serve pill switching side, segmented control, tab indicator |
| `sheet` | 280 ms in / 220 ms out | `Easing.out(Easing.cubic)` / `Easing.in(Easing.cubic)` | bottom sheets; scrim 0→0.35 |
| `screen` | 300 ms | native stack default (Android: fade-from-bottom) | navigation (`animation: 'fade_from_bottom'` in expo-router Stack) |
| `stagger` | 40 ms per item, 200 ms each | `FadeInDown.springify().damping(16)` | list rows / tiles on first mount (max 8 items) |
| `shimmer` | 1200 ms loop | linear | skeleton loaders |
| `shake` | 300 ms | 4× ±8 px | OTP wrong code, invalid form |
| `count` | 600 ms | `Easing.out(Easing.quad)` | Profile / summary stat counters 0→value on first view |

### Haptics (expo-haptics)
| Event | Call |
|---|---|
| Point scored (tap on team half) | `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` |
| Undo | `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` |
| Set point / match point reached | `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)` |
| Set won / match won | `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)` |
| Select player / chip / tab / segment | `Haptics.selectionAsync()` |
| Error (wrong OTP, need 6 players) | `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)` |
| Long-press (e.g. edit score) | `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)` |
Wrap in a `haptic()` helper that no-ops on web and when the user turns haptics off in settings.

### Reanimated snippets
`react-native-reanimated` is present in `node_modules` only as a transitive dependency; add it explicitly with `npx expo install react-native-reanimated` (plus the babel plugin if your SDK template needs it). If you'd rather not add it, the same timings work with RN `Animated` (as `PressableScale` already does).

**Team half: press + pop + floating +1 + haptic**
```tsx
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, withSequence, withDelay, Easing, useReducedMotion, SlideInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

export function TeamHalf({ team, score, onPoint }: Props) {
  const reduce = useReducedMotion();
  const press = useSharedValue(1);
  const pop = useSharedValue(1);
  const plusY = useSharedValue(0), plusO = useSharedValue(0);

  const onPressIn = () => { press.value = withTiming(reduce ? 1 : 0.97, { duration: 90 }); };
  const onPressOut = () => { press.value = withSpring(1, { damping: 14, stiffness: 320 }); };
  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPoint();                                         // state update first – never wait for animation
    if (reduce) return;
    pop.value = withSequence(withTiming(1.12, { duration: 90 }), withSpring(1, { damping: 12, stiffness: 260, mass: 0.8 }));
    plusO.value = withSequence(withTiming(1, { duration: 60 }), withDelay(120, withTiming(0, { duration: 330 })));
    plusY.value = 0;
    plusY.value = withTiming(-24, { duration: 450, easing: Easing.out(Easing.cubic) });
  };

  const halfStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const scoreStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const plusStyle = useAnimatedStyle(() => ({ opacity: plusO.value, transform: [{ translateY: plusY.value }] }));

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false, foreground: true }}
      accessibilityRole="button" accessibilityLabel={t('score.pointTo', { team: team.name })}
      accessibilityHint={`${score}`} style={{ flex: 1 }}>
      <Animated.View style={[styles.half, { backgroundColor: team.color }, halfStyle]}>
        {/* name, set pips … */}
        <Animated.Text key={score} entering={reduce ? undefined : SlideInDown.duration(220)} style={[type.score, scoreStyle]}>{score}</Animated.Text>
        <Animated.View style={[styles.plus, plusStyle]}><Text style={styles.plusTxt}>+1</Text></Animated.View>
        {/* serve pill, timeout chip … */}
      </Animated.View>
    </Pressable>
  );
}
```
(The `key={score}` + `SlideInDown` gives the "number rolls up" effect; Undo uses `SlideInUp` so the number rolls back down.)

**Serve pill moving across halves (side-out)**: render a single absolutely-positioned pill above both halves and animate `left` with `withTiming(target, { duration: 260, easing: Easing.bezier(0.2, 0, 0, 1) })`. Rotation on the court: each player chip uses `Layout.springify().damping(16)` (Reanimated layout transition), so changing the order animates the clockwise shift automatically.

**Generic PressableScale (upgrade of the existing component)**
```tsx
const s = useSharedValue(1);
const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
<Pressable onPressIn={() => (s.value = withTiming(scaleTo, { duration: 90 }))}
           onPressOut={() => (s.value = withSpring(1, { damping: 14, stiffness: 320 }))} …>
  <Animated.View style={[style, resolved]}>{children}</Animated.View>
</Pressable>
```

**Skeleton shimmer**
```tsx
export function Skeleton({ w, h, r = 8, onDark = false }: { w: DimensionValue; h: number; r?: number; onDark?: boolean }) {
  const x = useSharedValue(-1);
  useEffect(() => { x.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false); }, []);
  const sheen = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 240 }] }));
  return (
    <View style={{ width: w, height: h, borderRadius: r, overflow: 'hidden', backgroundColor: onDark ? 'rgba(255,255,255,0.14)' : '#E6EBF2' }}>
      <Animated.View style={[StyleSheet.absoluteFill, sheen]}>
        <LinearGradient colors={['transparent', onDark ? 'rgba(255,255,255,0.12)' : '#F1F4F8', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, width: 160 }} />
      </Animated.View>
    </View>
  );
}
```
Show skeletons only if data takes > 300 ms (avoid flash), then cross-fade to content with `FadeIn.duration(200)`. Skeleton shapes must mirror the real layout (`09-home-loading.png`). Static chrome (search bar, tab bar, headers) renders immediately.

**Bottom sheet ("Who scored?")**: `SlideInDown.duration(280).easing(Easing.out(Easing.cubic))`, exit `SlideOutDown.duration(220)`, scrim `FadeIn` to `rgba(0,31,77,0.35)`. The scrim starts **below the team halves** so the scorer can still tap the next point. Tapping a half while the sheet is open = Skip + score. Auto-dismiss after 4 s with a thin progress line on the sheet top.

**Others**
- Live badge dot: opacity pulse 1 → 0.35 → 1, 1400 ms loop (`withRepeat`). Camera LIVE button: ring `rgba(198,40,40,0.35)` scales 1 → 1.15 and fades, 1600 ms loop while recording.
- Rank progress bars and the profile avatar ring: animate width / arc from 0 on first view, 700 ms `Easing.out(Easing.cubic)`.
- Match won: confetti burst (≤ 40 pieces, 1.2 s, then stop; skip with Reduce Motion) + Success haptic, then the summary screen.
- Tab bar: active indicator bar slides between tabs (`slide`), icon swaps outline → filled with a `pop`. Score FAB: `glowPrimary`, press 0.92.

## 7. Empty, loading and error states

Pattern: illustration (court/ball line art in `blueTint`/`court` with navy strokes, 76–120 dp) → H2 title saying **what's missing** → one body line saying **why it helps** → one primary CTA (light blue) → optional secondary (outline or text link). Never a dead end.

| Where | Title | Body | CTA |
|---|---|---|---|
| Home · no live matches (`08a`) | No live matches nearby | Start one and your friends can follow every point live. | Start a match |
| Home · new user (`08a`) | Get your first rank (checklist 1 of 3) | Set up profile ✓ · Join or create a team · Finish 3 matches | rows are tappable |
| Rankings · < 3 matches (`08b`) | The podium is waiting | Players appear here after 3 finished matches. Play 2 more to get your rank. | Start a match · Challenge a team |
| Profile · unranked | Not ranked yet | Finish {{n}} more matches to get a rank (`rankings.playMore`) | Start a match |
| Profile · no teams | No teams yet | Create a team and add players by mobile number. | + New team |
| Summary · no photos | No photos yet | Add photos from this match – everyone in it will see them. | Add photo · Camera |
| Summary · POTM pending | Pick Player of the Match | Auto-picked: most points. Tap another player to change. | Confirm |
| Live · offline | inline chip in header: `cloud-offline` + "Offline – saved on phone" (existing `syncOffline`) | | none (auto-retries) |
| Search · no results | No matches for "{{q}}" | Check the spelling or search by mobile number. | Clear search |
Errors: inline under the field in `lossText` 12/500 with `alert-circle` icon, plus Error haptic; never only colour (always an icon + text).

## 8. Per-screen component notes

### Shared
- **StatusBar**: `light` on navy screens, `dark` on Login sheet/OTP.
- **HeroHeader**: `LinearGradient gradients.hero`, paddingBottom 64 so the next card can use `marginTop: -48` and `zIndex: 3`. Optional decorative radial glow (light blue 25%) top-right.
- **TabBar**: navy, height 64 + inset, top radius 20. 5 items: Home · Map · **Score (FAB)** · Tournaments · Profile. FAB 56 dp `blue` with 5 dp navy ring, lifted 6 dp, label under it. Active: icon `blue` + white label + 18×3 light-blue indicator.
- **Card**: white, radius 16, `e2`, padding 14.
- **Buttons**: Primary (blue/navy, 48–52 h, radius 14, `glowPrimary`), Ink (navy/white), Outline (white, 1.5 border `grey200`, navy text), Disabled (`#E1E6EE` / `#4D5B70`, no glow; keep the label meaningful e.g. "Next: Rules · needs 6 per team").
- **Chip**: 32 h, radius pill; selected = navy fill/white text.
- **LiveBadge**: `redDark` 20 h radius 6, white 11/800, pulsing dot.
- **Sample-data / note badges in the PNGs are mockup-only; do not ship them.**

### 01 Home
- Hero: avatar 40 (light-blue fill, navy initials), greeting caption (`onInkMuted`) + name 17/800, two 40 dp glass buttons (`rgba(255,255,255,0.12)`) for Language and Notifications (light-blue unread dot).
- Search pill 44 h radius 14 → opens search screen (shared-element feel: fade 200 ms).
- Quick actions: card overlapping hero, 4×2 grid, tile 52×52 radius 16 `blueTint`, icon 24 navy, label 12/600 (wrap to 2 lines max, Hindi too). "New match" tile is the only filled `blue` + `glowPrimary`. Pressed tile = scale 0.92 + tile colour `#C9EEFB` (shown on Rankings in the mockup).
- Rank card: tint→white gradient, 44 dp navy square with `#3` in light blue, progress bar 6 h, trend in `green`. Tap → Rankings.
- Live now: horizontal `FlatList` with `snapToInterval={284}`, card 272 w; LIVE badge, competition, camera icon if streaming, team rows (10 dp colour dot, serve icon, sets, points 20/800 tabular; trailing team greyed), footer venue + "Watch" link.
- Upcoming: date block 44×48 (month overline in `blueText`).

### 02 Live scoring (most important)
- Header (navy): close (confirm dialog), centre title `SET 3 · TO 25` 16/800 + sync status line, **LIVE camera button** (36 h pill, `redDark`, white dot + "LIVE" + `videocam`, pulsing ring while recording; when not recording it is an outline pill "Go live" with `videocam-outline`), overflow menu (abandon, share live, rules).
- Set strip: finished sets as navy-2 pills (`S1 25–21`), current set pill light blue with running clock.
- **Team halves**: two `Pressable`s, flex 1, gap 8, **height 288**, radius 22, team-colour gradient + subtle top highlight. Content: name 16/800 (1 line, `adjustsFontSizeToFit` min 13), set pips (one per set needed to win; filled = won), score 104/900 tabular with soft text shadow, SERVING pill (`servePill()` colours, 2 px white ring), footer: timeout chip ("Timeout 2", 32 h, 25% black scrim; disabled at 0) and a `+` glyph hinting tap.
- The **whole half is the hit area** (≈ 164×288 dp). Long-press (500 ms) a half → "Edit score" sheet (Heavy haptic).
- Ticker: 34 h white strip, last rally ("Aarav · Spike · run of 3") + last 4 rally dots in team colours. Tap → timeline.
- **Court & rotation card**: court 186 h, fill `court`, white inner border, 2 attack lines, 4 dp navy net. Team A on the left facing right: front column (4 top, 3, 2 bottom) next to the net, back column (5, 6, 1). Team B mirrored (front 2 top, 3, 4; back 1, 6, 5). Chip = 30 dp circle in team colour, white 13/800 jersey number, 2 px white ring; name 11/700 navy below; tiny position number top-left. Server = light-blue ball badge on position 1 of the serving team. "Sub" link opens the lineup picker. When the half is swapped (Swap), the court mirrors too.
- Bottom bar (white, `barTop`): **Undo** primary (flex 1, 56 h) with a subtitle showing the result of undoing ("Back to 18–17"); Swap and Stats as 64×56 secondary tiles.
- After a point: haptic + pop + +1 (`02b`), then the "Who scored for {team}?" sheet: 3×2 grid of on-court players (52 h tiles, number circle + first name, selected = tint + `blueText` border + check), shot-type chips (Spike / Block / Ace / Tip / Opp. error), Skip in the header. Auto-closes after 4 s.
- Set point / match point: a 28 h banner slides in under the set strip ("SET POINT · Delhi Smashers", gold fill, navy text) + Warning haptic.
- Keep the screen awake (`expo-keep-awake`) and lock to portrait.

### 03 Profile
- Hero with 76 dp avatar inside a **conic progress ring** (`blue` arc = progress to next rank; on RN draw with `react-native-svg` circle `strokeDasharray`). Role / city as glass tags. "Edit" primary pill.
- Rank card overlaps hero (–68): medal tile, overline "YOUR RANK · ALL PLAYERS", `#3` at 44/900 + "of 12", rank-up pill (`successStrong` on `successBg`) + "this week", progress bar with thumb, "12 pts to #2 Meera", 3 KPI tiles (`bg` fill, 20/800 numbers), "See full rankings" link.
- Career stats: 4-up icon grid; recent form chips (W `green` / L `lossBg`+`lossText`, 28 dp) in the section header.
- Then My teams, Memories (photo grid), Match history, Language toggle and settings (in the gear).

### 04 Login / OTP
- Login: hero 360 h with logo tile (84 dp, radius 26, `blue`, glow) and tagline; language switch top-right (segmented, white selected). White sheet radius 28 overlapping at y = 320.
- Phone field 56 h, `+91` prefix with flag + divider, focused = 2 px `blueText` border + 4 dp 12% halo; max 10 digits, paste of 12-digit "91…" numbers strips the prefix (existing logic). Helper shows digit count. CTA disabled until 10 digits, then animates to primary (background colour 200 ms + glow).
- OTP: 6 boxes 56 h, filled = navy border, current = focus ring + blinking caret, empty = `bg`. Android SMS auto-read banner with spinner; resend countdown 30 s. Wrong code → shake + Error haptic + boxes turn `lossText` border for 1 s.

### 05 New match
- 3-step stepper in the navy header (Teams → Rules → Start), progress segments light blue.
- Team card: team badge (A/B circle in team colour), segmented control "Registered team | Add by number" (white thumb slides, 260 ms). Team name input with valid tick. Colour swatches 28 dp with a 2+2 ring when selected; disable colours that fail 3:1 against the other team (use `contrast()`).
- Players counter `5/12` + meter + red helper "1 more to start" (min 6, max 12).
- Player rows: 34 dp jersey square in team colour, name + masked phone, remove (×). Collapse after 2 rows into "+4 more · names… Show".
- Add-by-number: `+91` field; on 10 digits, look up the user → found card (tint, `blueLine` border) with avatar, "Registered" ✓, **Jersey #** mini input (auto-suggests next free number) and "+ Add" primary. Not registered → inline error (existing copy).
- Sticky bottom CTA "Next: Rules" disabled until both teams have ≥ 6.

### 06 Match summary
- Hero: "FULL TIME · 1h 12m" chip, two team avatars (52 dp, white ring), sets score 40/900, WINNER gold pill under the winner, set-by-set pills. Confetti only on first open after the match.
- POTM card: gold conic ring around avatar, gold overline, name 18/700, team · role · "+25 rank pts", 4 stat tiles. If not confirmed yet → the picker variant (existing `Potm` component) with "Confirm {name}".
- Tabs: Stats / Timeline / Photos (chips; selected navy) + "Add" tint chip. Photos: 2:1 mosaic (big tile spans 2 rows), caption gradient, "+N" overlay tile opens the viewer.
- Bottom bar: download (outline square) + "Share scorecard" primary with `logo-whatsapp`.

### 07 Rankings
- Filter chips on the hero (All time / This month / Near me).
- Podium: #1 centre (64 dp avatar, gold ring + glow, trophy above, block 72 h gold gradient), #2 left (52 dp, silver, 52 h), #3 right (bronze, 40 h). Current user on the podium gets "· You" and the trend.
- Formula line with info icon (tap → full formula sheet, existing `rankings.formula`).
- List rows 54 h: rank 14/800 muted, avatar 36, name + meta (`rowMeta`), trend (▲ green / ▼ `lossText` / – muted), points 16/800. Current user row: tint background + 4 px `blueText` left border.
- Sticky "You" bar (navy, radius 16, `e3`) only when your row is off-screen; CTA "Play" → New match.

## 9. Accessibility checklist
- All text pairs in §2 pass AA; minimum font size 11 dp; support font scaling up to 1.3× (score digits use `allowFontScaling={false}` but are already 104 dp).
- Team halves: `accessibilityRole="button"`, label "Point to Delhi Smashers, score 19", announce new score via `AccessibilityInfo.announceForAccessibility`.
- Never rely on colour alone: serve = pill with text + icon, W/L = letters, trend = arrow + number.
- Reduce Motion respected (see §6). Haptics can be disabled in settings.

## 10. Implementation order (suggested)
1. Tokens (`palette` additions, `type`, `radius`, `elevation`, `gradients`) + `haptic()` helper.
2. Live scoring (TeamHalf, ServePill, CourtCard, Who-scored sheet, Undo bar).
3. Home (HeroHeader, QuickActionGrid, RankProgressCard, LiveMatchCard carousel) + skeletons.
4. Profile + Rankings (shared RankCard, Podium).
5. Login/OTP, New match stepper, Match summary.
6. Empty states pass + Hindi QA at 360 dp.
