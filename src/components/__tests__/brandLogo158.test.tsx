/** 1.5.8 Bold Spiker in-app logo: Day / Night mark through useTheme, the badge on both; About and Login use it. */
import { render } from '@testing-library/react-native';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { BRAND, BrandLogo, brandLogoSource } from '../BrandLogo';
import { ThemeContext } from '../../theme/ThemeProvider';
import { tokens } from '../../theme/tokens';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 } as never);
const root = path.join(__dirname, '..', '..', '..');

describe('BrandLogo', () => {
  it('picks the mark per theme and the badge on both', () => {
    expect(brandLogoSource('mark', 'day')).toBe(BRAND.markDay);
    expect(brandLogoSource('mark', 'night')).toBe(BRAND.markNight);
    expect(brandLogoSource('badge', 'day')).toBe(BRAND.badge);
    expect(brandLogoSource('badge', 'night')).toBe(BRAND.badge);
  });
  it.each(['day', 'night'] as const)('renders in %s with its label', async (name) => {
    const r = await render(<ThemeContext.Provider value={ctx(name)}><BrandLogo size={88} accessibilityLabel="VolleyLive logo" testID="logo" /></ThemeContext.Provider>);
    const img = r.getByTestId('logo');
    expect(img.props.source).toBe(name === 'night' ? BRAND.markNight : BRAND.markDay);
    expect(img.props.accessibilityLabel).toBe('VolleyLive logo');
  });
  it('all brand files (1x, @2x, @3x) are in assets/brand', () => {
    for (const b of ['logo-badge', 'logo-mark-day', 'logo-mark-night']) for (const s of ['', '@2x', '@3x']) expect(fs.existsSync(path.join(root, 'assets', 'brand', `${b}${s}.png`))).toBe(true);
  });
  it('About and Login render the brand logo (no old icon.png in the UI)', () => {
    expect(fs.readFileSync(path.join(root, 'src/app/about.tsx'), 'utf8')).toMatch(/<BrandLogo size=\{88\}/);
    expect(fs.readFileSync(path.join(root, 'src/app/login.tsx'), 'utf8')).toMatch(/<BrandLogo variant="badge"/);
    expect(fs.readFileSync(path.join(root, 'src/app/about.tsx'), 'utf8')).not.toMatch(/assets\/icon\.png/);
  });
});
