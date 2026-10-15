/**
 * Theme typography (spec v2 §2 + §4.2). 1.4.21 only set Mukta for Night + Hindi; 1.4.22 bundles every spec family:
 *  Day: display Baloo 2 800, body Hind (both cover Devanagari). Night: display Teko 600 UPPERCASE (Latin),
 *  body Mukta; in Hindi the display face is Mukta 800, sentence case, no letter-spacing. Score numerals: Day Baloo 2,
 *  Night Teko (also in Hindi). A custom family carries its own weight: fontWeight is reset so Android does not fake-bold.
 */
import { useTranslation } from 'react-i18next';
import { useTheme } from './ThemeProvider';
import type { Tokens } from './tokens';

type F = Partial<Tokens['font']> & { bodyHi?: string; boldHi?: string; displayHi?: string };
const fam = (f: string | undefined) => (f ? { fontFamily: f, fontWeight: 'normal' as const } : null);
export function hiFont(name: 'day' | 'night', lang: string, f: F) {
  const hi = lang.startsWith('hi');
  const nightHi = name === 'night' && hi;
  return {
    body: f.body ? { fontFamily: nightHi ? f.bodyHi ?? f.body : f.body } : null,
    bold: fam(nightHi ? f.boldHi ?? f.bold : f.bold),
    semibold: fam(nightHi ? f.boldHi ?? f.semibold : f.semibold),
    display: fam(nightHi ? f.displayHi : f.display),
    score: fam(f.score),
    /** Night Latin display is UPPERCASE with tracking; Hindi never (no case, and Teko lacks Devanagari). */
    upper: !!f.upperDisplay && !hi,
  };
}
export function useHiFont() {
  const { name, t } = useTheme();
  const { i18n } = useTranslation();
  return hiFont(name, i18n.language ?? 'en', t.font);
}
