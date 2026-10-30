/**
 * 1.5.8 Bold Spiker in-app logo (assets/brand, from volleylive-design/logo/v2/final-bold-spiker).
 * - variant 'mark' (default): the mark only – logo-mark-day (ink outline, blue streaks) on the Day cream / white
 *   background, logo-mark-night (glow) on the Night navy background, picked through useTheme.
 * - variant 'badge': the blue badge with the yellow ring, the same on both themes.
 * @2x / @3x files resolve automatically through require().
 */
import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export const BRAND = {
  badge: require('../../assets/brand/logo-badge.png'),
  markDay: require('../../assets/brand/logo-mark-day.png'),
  markNight: require('../../assets/brand/logo-mark-night.png'),
} as const;

export function brandLogoSource(variant: 'mark' | 'badge', theme: string) {
  if (variant === 'badge') return BRAND.badge;
  return theme === 'night' ? BRAND.markNight : BRAND.markDay;
}

export function BrandLogo({ variant = 'mark', size = 88, style, accessibilityLabel, testID }: {
  variant?: 'mark' | 'badge'; size?: number; style?: StyleProp<ImageStyle>; accessibilityLabel?: string; testID?: string;
}) {
  const { name } = useTheme();
  return (
    <Image
      source={brandLogoSource(variant, name)}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      testID={testID}
    />
  );
}
