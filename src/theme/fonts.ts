/**
 * Bundled fonts – OFL only (licence files next to the fonts; docs/FONT-LICENSES.md and the in-app Licences screen).
 *  - Mukta (Ek Type): Night body + Hindi display (spec §2, §4.2).
 *  - Teko SemiBold (Teko Project Authors): Night display + score numerals. Static 600 instance of the OFL variable font
 *    (fontTools instancer; family name unchanged – Teko has no Reserved Font Name).
 *  - Baloo 2 ExtraBold (Baloo 2 Project Authors): Day display + score stickers (Latin + Devanagari). Static 800 instance.
 *  - Hind Regular/SemiBold/Bold (Indian Type Foundry): Day body (Latin + Devanagari).
 */
export const APP_FONTS = {
  'Mukta-Regular': require('../../assets/fonts/mukta/Mukta-Regular.ttf'),
  'Mukta-Bold': require('../../assets/fonts/mukta/Mukta-Bold.ttf'),
  'Mukta-ExtraBold': require('../../assets/fonts/mukta/Mukta-ExtraBold.ttf'),
  'Teko-SemiBold': require('../../assets/fonts/teko/Teko-SemiBold.ttf'),
  'Baloo2-ExtraBold': require('../../assets/fonts/baloo2/Baloo2-ExtraBold.ttf'),
  'Hind-Regular': require('../../assets/fonts/hind/Hind-Regular.ttf'),
  'Hind-SemiBold': require('../../assets/fonts/hind/Hind-SemiBold.ttf'),
  'Hind-Bold': require('../../assets/fonts/hind/Hind-Bold.ttf'),
};
export const MUKTA_FONTS = APP_FONTS; // (name kept for the layout import)
