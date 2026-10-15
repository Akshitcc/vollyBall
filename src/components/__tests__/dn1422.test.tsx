/**
 * 1.4.22 day/night spec v2 rebuild: reward (*-07), POTM card, appearance pieces, reactions, team record,
 * late-night greeting copy, AA contrast of the spec pairs in both themes, EN/HI parity of the new keys.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
let mockIsAdmin = false;
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { applyTheme, contrast } from '../../theme';
import { ThemeContext } from '../../theme/ThemeProvider';
import { SPEC_TEXT_PAIRS, tokens } from '../../theme/tokens';
import { teamRecord } from '../../core/teamRecord';
import { RewardScreen } from '../RewardScreen';
import { ReactionButton } from '../DayNightKit';
import type { Match } from '../../core/types';

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
const inTheme = (name: 'day' | 'night', el: React.ReactElement) => { applyTheme(name); return <ThemeContext.Provider value={ctx(name)}>{el}</ThemeContext.Provider>; };

describe('reward / win screen (spec v2 *-07)', () => {
  afterEach(() => applyTheme('day'));
  for (const lng of ['en', 'hi'] as const)
    for (const th of ['day', 'night'] as const)
      it(`${lng} ${th}: title, line, set score, share + summary, close; decor matches the theme`, async () => {
        await i18n.changeLanguage(lng);
        const onShare = jest.fn(), onSummary = jest.fn(), onClose = jest.fn();
        await render(inTheme(th, <RewardScreen title={i18n.t(th === 'day' ? 'dn.weWon' : 'dn.victory')} overline={i18n.t('dn.fullTime')} line={i18n.t('dn.beat', { win: 'A', lose: 'B' })} setsA={3} setsB={1} setLines="25–21 · 22–25" onShare={onShare} onSummary={onSummary} onClose={onClose} />));
        expect(screen.getByTestId('reward-title')).toHaveTextContent(i18n.t(th === 'day' ? 'dn.weWon' : 'dn.victory'));
        expect(screen.getByTestId('reward-line')).toHaveTextContent(lng === 'en' ? 'A beat B' : 'A ने B को हराया');
        expect(screen.getByTestId(th === 'day' ? 'reward-confetti' : 'reward-rays', { includeHiddenElements: true })).toBeTruthy();
        expect(screen.queryByTestId(th === 'day' ? 'reward-rays' : 'reward-confetti', { includeHiddenElements: true })).toBeNull();
        await fireEvent.press(screen.getByTestId('reward-share')); await fireEvent.press(screen.getByTestId('reward-summary')); await fireEvent.press(screen.getByTestId('match-over-close'));
        expect([onShare, onSummary, onClose].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
        expect(screen.getByTestId('match-over-close').props.accessibilityLabel).toBe(i18n.t('score.closeResult'));
      });
});

describe('reactions are UI only (no backend)', () => {
  it('a tap shows a local +1 and calls only the given handler', async () => {
    const f = jest.fn();
    await render(<ReactionButton emoji="🔥" label="React 🔥" onPress={f} testID="r" />);
    await fireEvent.press(screen.getByTestId('r'));
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('r-sent')).toBeTruthy();
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/match/[id]/index.tsx'), 'utf8') as string;
    expect(src).toMatch(/testID=\{`reaction-\$\{i\}`\}/);
    expect(src).toMatch(/onPress=\{\(\) => undefined\}/); // nothing is sent
  });
});

describe('teamRecord', () => {
  const m = (a: string, b: string, winner: 'A' | 'B' | null, status = 'finished') => ({ status, teamA: { teamId: a }, teamB: { teamId: b }, summary: { winner } }) as unknown as Match;
  it('counts finished matches with a winner only, from either side', () => {
    expect(teamRecord('t1', [m('t1', 't2', 'A'), m('t2', 't1', 'A'), m('t1', 't3', 'A'), m('t1', 't2', null), m('t1', 't2', 'A', 'live')])).toEqual({ played: 3, won: 2, lost: 1, winRate: 67 });
    expect(teamRecord('t9', null)).toEqual({ played: 0, won: 0, lost: 0, winRate: 0 });
  });
});

describe('copy', () => {
  it('late-night greeting EN + HI', () => {
    expect(i18n.t('greet.night', { lng: 'en', name: 'Aarav' })).toBe('Late game, Aarav?');
    expect(i18n.t('greet.night', { lng: 'hi', name: 'Aarav' })).toBe('देर रात का मैच, Aarav?');
  });
  it('every 1.4.22 dn.* key exists in EN and HI, HI differs from EN except brand-neutral placeholders', () => {
    const e = en.dn as Record<string, string>, h = hi.dn as Record<string, string>;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) { expect(h[k].length).toBeGreaterThan(0); expect(h[k]).not.toBe(e[k]); }
    // placeholders survive translation
    for (const k of Object.keys(e)) expect((h[k].match(/\{\{\w+\}\}/g) ?? []).sort()).toEqual((e[k].match(/\{\{\w+\}\}/g) ?? []).sort());
  });
  it('every dn.* key used by the source exists', () => {
    const fs = require('fs'), path = require('path');
    const root = path.resolve(__dirname, '../..');
    const files = ['app/(tabs)/index.tsx', 'app/(tabs)/profile.tsx', 'app/team/[id].tsx', 'app/tournament/[id].tsx', 'app/login.tsx', 'app/appearance.tsx', 'app/match/[id]/score.tsx', 'app/match/[id]/index.tsx', 'components/RewardScreen.tsx', 'components/RankCard.tsx'];
    const used = new Set<string>();
    for (const f of files) for (const x of (fs.readFileSync(path.join(root, f), 'utf8') as string).matchAll(/'dn\.(\w+)'/g)) used.add(x[1]);
    for (const k of used) expect(Object.keys(en.dn)).toContain(k);
  });
});

describe('AA contrast of every spec text pair, both themes', () => {
  for (const th of ['day', 'night'] as const)
    it(th, () => {
      for (const [fg, bg] of SPEC_TEXT_PAIRS) expect([fg, bg, contrast(tokens[th][fg] as string, tokens[th][bg] as string) >= 4.5]).toEqual([fg, bg, true]);
    });
  it('night accent is never a text background (3.4:1)', () => {
    expect(SPEC_TEXT_PAIRS.some(([, bg]) => bg === 'accent')).toBe(tokens.day.accent === tokens.night.accent);
  });
});

describe('rebuilt screen layouts carry the spec v2 parts (source check; rendered checks are in the 422-* screenshots)', () => {
  const fs = require('fs'), path = require('path');
  const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '../..', f), 'utf8') as string;
  const want: Record<string, string[]> = {
    'app/(tabs)/index.tsx': ['home-header', 'live-hero', 'live-hero-score', 'qa-'],
    'app/(tabs)/_layout.tsx': ['tab-fab', 'tab-active-pill'],
    'components/ViewerParts.tsx': ['team-panel-', 'minHeight: 214'],
    'components/LiveScoring.tsx': ['court-net'],
    'app/team/[id].tsx': ['team-header', 'team-stats', 'team-roster', 'team-add-row'],
    'app/tournament/[id].tsx': ['tournament-hero', 'tournament-tabs', 'SegmentedControl'],
    'app/(tabs)/profile.tsx': ['profile-hero', 'profile-identity', 'career-stats'],
    'app/login.tsx': ['login-steps', 'login-title', 'otp-steps', 'verify-otp-hint'],
    'app/appearance.tsx': ['appearance-now-card', 'appearance-${s}', 'appearance-anim', 'accessibilityRole="radio"'],
    'app/match/new.tsx': ['step-dot-'],
    'app/match/[id]/index.tsx': ['viewer-reactions', 'ReactionButton'],
    'components/RewardScreen.tsx': ['reward-title', 'reward-share', 'reward-summary', 'match-over-close'],
    'components/Potm.tsx': ['potm-badge', 'potm-label'],
  };
  for (const [f, ids] of Object.entries(want)) it(f, () => { const s = read(f); for (const id of ids) expect([f, id, s.includes(id)]).toEqual([f, id, true]); });
  it('no rebuilt screen hard-codes white text', () => {
    for (const f of ['components/RewardScreen.tsx', 'app/appearance.tsx', 'components/DNKit.tsx']) expect(read(f)).not.toMatch(/color: ['"]#(FFF|FFFFFF)['"]/i);
  });
});
