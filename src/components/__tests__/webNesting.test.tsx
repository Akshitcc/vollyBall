/**
 * QA B121-1 (1.3.1): web render of the live-scoring halves with react-native-web + react-dom. On web a
 * Pressable with role "button" becomes a real <button>; a <button> inside another <button> is invalid
 * HTML (React logs "validateDOMNesting"). The timeout chip must be a sibling of the scoring button.
 */
jest.mock('react-native', () => require('react-native-web'));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native-web');
  return { LinearGradient: ({ children, style, colors: _c, start: _s, end: _e, ...rest }: any) => require('react').createElement(View, { style, ...rest }, children) };
});
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native-web');
  const id = (v: unknown) => v;
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: id },
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: id,
    withSpring: id,
    withSequence: id,
    withDelay: (_d: number, v: unknown) => v,
    withRepeat: id,
    Easing: { out: () => id, cubic: id, inOut: () => id, quad: id },
  };
});
jest.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => true }));

import React from 'react';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- no @types/react-dom in the project (no new dependency)
const { renderToStaticMarkup } = require('react-dom/server') as { renderToStaticMarkup: (el: React.ReactElement) => string };

const props = (side: 'A' | 'B', over: Record<string, unknown> = {}) => ({ side, name: side === 'A' ? 'Delhi Smashers' : 'Yamuna Blockers', color: side === 'A' ? '#D93636' : '#001F4D', score: 3, setsWon: 1, setsToWin: 2, serving: side === 'A', point: null, timeoutsLeft: 2, compact: false, showHint: false, onPoint: () => {}, onTimeout: () => {}, height: 288, ...over });

/** Every <button> opened while another <button> is still open (simple tag scan of static markup). */
function nestedButtons(html: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)button\b([^>]*)>/g)) {
    if (m[1]) depth--;
    else {
      if (depth > 0) out.push(m[2].match(/data-testid="([^"]*)"/)?.[1] ?? m[2]);
      depth++;
    }
  }
  return out;
}

describe('B121-1 web markup', () => {
  const { TeamHalf } = require('../LiveScoring');
  it.each(['en', 'hi'])('%s: score halves render real <button>s and none is nested in another', async (lng) => {
    await require('../../i18n').default.changeLanguage(lng);
    const html = renderToStaticMarkup(
      <>
        <TeamHalf {...props('A')} />
        <TeamHalf {...props('B', { timeoutsLeft: 0 })} />
      </>,
    );
    const buttons = html.match(/<button\b/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(4); // tap-A, timeout-A, tap-B, timeout-B
    expect(html).toContain('data-testid="timeout-A"');
    expect(html).toContain('data-testid="tap-A"');
    expect(nestedButtons(html)).toEqual([]);
  });
  it('C130-5: the timeout label may wrap to 2 lines (the HI label is never cut to one clipped line)', async () => {
    await require('../../i18n').default.changeLanguage('hi');
    const html = renderToStaticMarkup(<TeamHalf {...props('A')} />);
    const label = html.match(/<div[^>]*data-testid="timeout-label-A"[^>]*>/)?.[0] ?? '';
    expect(label).toMatch(/line-clamp:\s*2/);
    expect(label).not.toMatch(/white-space:\s*nowrap/);
    await require('../../i18n').default.changeLanguage('en');
  });
  it('the scanner itself catches a nested button', () => {
    expect(nestedButtons('<button data-testid="a"><span><button data-testid="b"></button></span></button>')).toEqual(['b']);
  });
});
