/** 1.5.0 Tester's hands-on UI pass of 1.4.28: F1428-5 (a nameless pin never blocks), F1428-6 (Ask VolleyLive on Home,
 * Day/Night, 360 px), F1428-7 (Profile rank label wraps instead of clipping). */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import i18n from '../../i18n';
import { applyTheme, contrast } from '../../theme';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';
import { namedPlace } from '../../core/geo';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
jest.mock('../../services/backend', () => ({ backend: {} }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true }), useMe: () => ({ id: 'me', name: 'Aarav Sharma', phone: '+919000000010' }) }));

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
const inTheme = (name: 'day' | 'night', el: React.ReactElement) => { applyTheme(name); return <ThemeContext.Provider value={ctx(name)}>{el}</ThemeContext.Provider>; };
afterEach(async () => { applyTheme('day'); await i18n.changeLanguage('en'); mockPush.mockClear(); });

type Node = { type: string; props: Record<string, any>; children: (Node | string)[] | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
function lowContrast(tree: Node | Node[] | null, bg: string): string[] {
  const out: string[] = [];
  const walk = (n: Node | string, under: string) => {
    if (typeof n === 'string') return;
    const s = (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, string>;
    const paint = typeof s.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.backgroundColor) ? s.backgroundColor : under;
    if (n.type === 'Text' && typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) && contrast(s.color, paint) < 4.5) out.push(`${s.color} on ${paint}`);
    for (const c of n.children ?? []) walk(c, paint);
  };
  for (const n of Array.isArray(tree) ? tree : tree ? [tree] : []) walk(n, bg);
  return out;
}

describe('F1428-5: a pin without a place name is saved as "Pinned location"', () => {
  it('namedPlace keeps the coordinates and a typed name; fills the default otherwise', () => {
    expect(namedPlace({ lat: 19.1, lng: 72.8, name: '  ' }, 'Pinned location')).toEqual({ lat: 19.1, lng: 72.8, name: 'Pinned location' });
    expect(namedPlace({ lat: 19.1, lng: 72.8, name: ' Juhu court ' }, 'Pinned location')!.name).toBe('Juhu court');
    expect(namedPlace(null, 'x')).toBeNull();
  });
  it('New match and Challenge no longer stop on a missing place name', () => {
    const fs = require('fs'), path = require('path');
    for (const f of ['app/match/new.tsx', 'app/challenge/new.tsx']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8') as string;
      expect(src).not.toMatch(/location\.nameRequired/);
      expect(src).toMatch(/namedPlace\(location, t?r?\('location\.pinnedName'\)\)/);
    }
    expect(i18n.getFixedT('hi')('location.pinnedName')).toMatch(/[\u0900-\u097F]/);
  });
});

describe('F1428-6: Ask VolleyLive card on Home', () => {
  for (const lng of ['en', 'hi'] as const)
    for (const th of ['day', 'night'] as const)
      it(`${lng} ${th}: opens /ask; title and text wrap (2 lines) at 360 px; AA contrast`, async () => {
        await i18n.changeLanguage(lng);
        const { HomeAskCard } = require('../../app/(tabs)/index');
        const r = await render(inTheme(th, <HomeAskCard />));
        expect(screen.getByText(i18n.t('home.askTitle')).props.numberOfLines).toBe(2);
        expect(screen.getByText(i18n.t('home.askText')).props.numberOfLines).toBe(2);
        await fireEvent.press(screen.getByTestId('home-ask'));
        expect(mockPush).toHaveBeenCalledWith('/ask');
        expect(lowContrast(r.toJSON() as never, tokens[th].bg)).toEqual([]);
      });
  it('the card is placed on the Home screen right after the quick actions', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../app/(tabs)/index.tsx'), 'utf8') as string;
    expect(src.indexOf('<HomeAskCard />')).toBeGreaterThan(src.indexOf('testID="quick-actions"'));
  });
});

describe('F1428-7: Profile rank label wraps at 360 px (EN Day)', () => {
  it('2 lines, full text (no clipping to one line)', async () => {
    await i18n.changeLanguage('en');
    const { RankCard } = require('../RankCard');
    const row = (id: string, rank: number) => ({ playerId: id, name: id, rankingPoints: 100 - rank, rank, points: 0, wins: 0, potm: 0, matches: 5, winPct: 0 });
    const ranked = [1, 2, 3, 4].map((r) => row(`p${r}`, r));
    await render(inTheme('day', <RankCard rankings={{ ranked, total: 1234, me: ranked[2] }} />));
    const label = screen.getByTestId('profile-rank-label');
    expect(label.props.numberOfLines).toBe(2);
    expect(label).toHaveTextContent('Your rank · All players · of 1234');
  });
});
