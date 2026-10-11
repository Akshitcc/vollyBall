/**
 * Tab bar sizes (QA V2): labels may take two lines and shrink instead of being cut to
 * "Tourname…", and Devanagari gets a taller line so its vowel marks (ि ी ु ू ं) aren't clipped.
 * Checked at 360 and 412 px wide in EN and HI (screenshots 26-tabs-*).
 */
export function tabBarMetrics(lang: string, bottomInset: number, screenWidth = 412) {
  const hi = lang.startsWith('hi');
  // Each tab gets a fifth of the width; on a 360 px phone "Tournaments" only fits at 9.5 px
  // (a long word must shrink, never break in the middle).
  const narrow = screenWidth < 400;
  const fontSize = hi ? (narrow ? 10.5 : 11) : narrow ? 9.5 : 10.5;
  const lineHeight = hi ? 17 : 13;
  const labelHeight = lineHeight * 2;
  const height = 6 + 24 + 2 + labelHeight + 6 + bottomInset;
  return { fontSize, lineHeight, height, paddingTop: 6, paddingBottom: 6 + bottomInset };
}
