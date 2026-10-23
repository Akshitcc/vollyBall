/** 1.5.1 UI: F150-7 result state on the Ask match list (EN/HI × Day/Night, contrast) and F150-2 team page lines. */
import { render } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { applyTheme, contrast } from '../../theme';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';
import type { AskCard } from '../../core/ask/cards';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
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
const STATES = ['counted', 'awaiting', 'potm', 'review', 'reviewAwaiting', 'disputed', 'voided'] as const;
const card: AskCard = { type: 'fixtures', title: 'Past matches', items: STATES.map((r, i) => ({ id: `m${i}`, matchId: `m${i}`, label: '', home: 'Goregaon Giants Volleyball Club Under-21', away: 'Juhu T01', status: 'finished', setsA: 2, setsB: 1, when: 1, result: r })) };

afterEach(async () => { applyTheme('day'); await i18n.changeLanguage('en'); });

describe.each([['en', 'day'], ['en', 'night'], ['hi', 'day'], ['hi', 'night']] as const)('F150-7 Ask match list %s / %s', (lang, theme) => {
  it('every finished result shows its state (2 lines max), readable', async () => {
    await i18n.changeLanguage(lang);
    applyTheme(theme);
    const { AskCards } = require('../ask/AskCards');
    const r = await render(<ThemeContext.Provider value={ctx(theme)}><AskCards cards={[card]} testID="cards" /></ThemeContext.Provider>);
    STATES.forEach((s, i) => {
      const n = r.getByTestId(`ask-fixture-result-m${i}`);
      expect(n).toHaveTextContent(i18n.getFixedT(lang)(`ask.card.result.${s}`));
      expect(n.props.numberOfLines).toBe(2);
    });
    expect(lowContrast(r.toJSON() as never, tokens[theme].bg)).toEqual([]);
  });
});

describe('F150-2 team page', () => {
  it('shows each open state on its own line (no "waiting for the other captain" for flagged / rejected / voided)', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../app/team/[id].tsx'), 'utf8') as string;
    expect(src).toMatch(/rec\.awaiting \?.*team-stats-pending.*dn\.pendingResults', \{ count: rec\.awaiting \}/);
    for (const [k, id] of [['review', 'team-stats-review'], ['disputed', 'team-stats-disputed'], ['potm', 'team-stats-potm']]) expect(src).toContain(`rec.${k} ? <Body muted size={12} style={{ marginTop: 4 }} testID="${id}">{t('dn.${k}Results', { count: rec.${k} })}`);
  });
  it('EN/HI plural copy for every state', () => {
    for (const L of [en, hi] as unknown as { dn: Record<string, string> }[])
      for (const k of ['pendingResults', 'reviewResults', 'disputedResults', 'potmResults']) for (const f of ['_one', '_other']) expect(L.dn[k + f]).toMatch(/\{\{count\}\}/);
    expect(hi.dn.reviewResults_one).toMatch(/[\u0900-\u097F]/);
    expect(i18n.getFixedT('en')('dn.reviewResults', { count: 2 })).toBe('2 results are under admin review – they count once an admin approves them.');
  });
});
