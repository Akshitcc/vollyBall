/**
 * 1.4.0 UI: V139-7 (review prompt waits for the POTM picker / modals / dialogs), V139-8 (pressables are
 * buttons / links for keyboard and screen readers), V139-9 (date on finished match cards; admin back → Profile).
 */
import { act, render, screen } from '@testing-library/react-native';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { Text } from 'react-native';
import i18n from '../../i18n';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false) } }));
const mockAsk = jest.fn(async (_o: unknown) => undefined);
jest.mock('../../services/review', () => ({ maybeAskForReview: (o: unknown) => mockAsk(o) }));
jest.mock('../../services/backend', () => ({
  backend: {
    watchMyMatches: (_uid: string, cb: (m: unknown[]) => void) => {
      cb([{ status: 'finished' }, { status: 'finished' }, { status: 'finished' }]);
      return () => undefined;
    },
  },
}));

const base = {
  id: 'm1', status: 'live', title: null, events: [], createdAt: Date.UTC(2026, 9, 1), updatedAt: 0, scorerId: 'u2', createdBy: 'u2',
  teamA: { name: 'Smashers', color: '#123456', players: [{ id: 'u1', name: 'Me' }] },
  teamB: { name: 'Blockers', color: '#654321', players: [{ id: 'u3', name: 'Them' }] },
  summary: { setsA: 0, setsB: 0, currentA: 0, currentB: 0, setScores: [], winner: null, serving: 'A' },
} as unknown as Match;
const won = (over: Partial<Match> = {}) => ({ ...base, status: 'finished', finishedAt: Date.now(), summary: { ...base.summary, setsA: 3, winner: 'A', setScores: [{ a: 25, b: 10 }] }, ...over }) as Match;

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});
afterEach(() => jest.useRealTimers());

describe('V139-7: the review prompt never opens over the POTM picker, a modal or a dialog', () => {
  const { useReviewPrompt } = require('../../state/useReviewPrompt');
  const { HoldUi } = require('../../state/uiBusy');
  const { Modal } = require('../AppModal');
  function Screen({ m, picker, modal }: { m: Match; picker?: boolean; modal?: boolean }) {
    useReviewPrompt(m, 'u1');
    return (
      <>
        {picker ? <HoldUi /> : null}
        <Modal visible={!!modal} transparent>
          <Text>sheet</Text>
        </Modal>
      </>
    );
  }
  const tick = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  it('finishing with the picker open: no prompt until the scorer has picked (picker closed), then after a pause', async () => {
    jest.useFakeTimers();
    const r = await render(<Screen m={base} picker />);
    await r.rerender(<Screen m={won()} picker />); // the match finishes while the screen is open
    await tick(10_000);
    expect(mockAsk).not.toHaveBeenCalled();
    await r.rerender(<Screen m={won()} />); // POTM chosen: the picker is gone
    await tick(1000);
    expect(mockAsk).not.toHaveBeenCalled(); // still the short pause
    await tick(600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('a modal (AppModal) that is visible holds the prompt; it opens after the modal closes', async () => {
    jest.useFakeTimers();
    const r = await render(<Screen m={base} modal />);
    await r.rerender(<Screen m={won()} modal />);
    await tick(5000);
    expect(mockAsk).not.toHaveBeenCalled();
    await r.rerender(<Screen m={won()} modal={false} />);
    await tick(1600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('an in-app dialog holds it too; a modal opened during the pause pushes it back again', async () => {
    jest.useFakeTimers();
    const { openDialog, closeDialog } = require('../../state/dialog');
    const r = await render(<Screen m={base} />);
    void openDialog({ title: 't', message: 'm', buttons: [{ text: 'OK', value: true }] });
    await r.rerender(<Screen m={won()} />);
    await tick(5000);
    expect(mockAsk).not.toHaveBeenCalled();
    await act(async () => closeDialog(true));
    await tick(800);
    await r.rerender(<Screen m={won()} modal />); // opened during the pause
    await tick(5000);
    expect(mockAsk).not.toHaveBeenCalled();
    await r.rerender(<Screen m={won()} modal={false} />);
    await tick(1600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('nothing open: asks after the usual pause', async () => {
    jest.useFakeTimers();
    const r = await render(<Screen m={base} />);
    await r.rerender(<Screen m={won()} />);
    await tick(1600);
    expect(mockAsk).toHaveBeenCalledTimes(1);
  });

  it('the POTM picker holds the UI while shown; every Modal in the app comes from AppModal', () => {
    const potm = fs.readFileSync(path.join(__dirname, '../Potm.tsx'), 'utf8');
    expect(potm).toMatch(/testID="potm-picker">\s*<HoldUi \/>/);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === '__tests__' || f.name === 'node_modules') continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f.name)) files.push(p);
      }
    };
    walk(path.join(__dirname, '../..'));
    const direct = files.filter((f) => !/AppModal\.tsx$|DialogHost\.tsx$/.test(f) && /import \{[^}]*\bModal\b[^}]*\} from 'react-native'/.test(fs.readFileSync(f, 'utf8')));
    expect(direct).toEqual([]); // DialogHost: the dialog itself is tracked by state/dialog
  });
});

describe('V139-8: keyboard / screen reader – pressables are buttons (web: a real <button>, Enter + Space)', () => {
  it('Button (e.g. "Confirm result") has role button', async () => {
    const { Button } = require('../ui');
    await render(<Button title="Confirm result" onPress={() => undefined} testID="confirm-result" />);
    expect(screen.getByTestId('confirm-result').props.accessibilityRole).toBe('button');
  });
  it('every Pressable with onPress declares a role, except backdrops and the decorative ones listed here', () => {
    const allowed = [
      'components/DialogHost.tsx', // scrim (accessible={false}) + the dialog box
      'components/LiveScoring.tsx', // "+" next to the big point button (accessible={false}; the big button is the control)
      'components/PhotoSheet.tsx', // scrim (labelled "Close")
      'components/maps/PreviewMap.tsx', // the map surface and its sheet backdrop
      'app/login.tsx', // the OTP boxes focus the hidden input (accessible={false})
      'app/(tabs)/_layout.tsx', // tab buttons (React Navigation passes role="tab")
      'app/match/[id]/score.tsx:menu', // the menu sheet's backdrop, and (1.4.1 V140-14) the match-over sheet's (hidden from AT; the sheet has a Close button)
      'components/ViewerParts.tsx:serving-guard', // 1.4.5 (V144-7): catches a press on the Serving badge (accessible={false}, a no-op) so it can't score
    ];
    const root = path.join(__dirname, '../..');
    const missing: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === '__tests__') continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.tsx')) {
          const s = fs.readFileSync(p, 'utf8');
          const rel = path.relative(root, p);
          for (const m of s.matchAll(/<(Pressable|PressableScale)\b/g)) {
            let i = m.index! + m[0].length;
            let depth = 0;
            for (; i < s.length; i++) {
              if (s[i] === '{') depth++;
              else if (s[i] === '}') depth--;
              else if (s[i] === '>' && depth === 0 && s[i - 1] !== '=') break;
            }
            const tag = s.slice(m.index!, i);
            if (/accessibilityRole=|\brole=/.test(tag) || !/onPress=/.test(tag)) continue;
            const line = s.slice(0, m.index!).split('\n').length;
            const isMenu = rel.endsWith('score.tsx') && (/setMenu\(false\)/.test(tag) || /testID="match-over-backdrop"/.test(tag));
            const isGuard = rel.endsWith('ViewerParts.tsx') && /testID=\{`serving-guard-/.test(tag) && /accessible=\{false\}/.test(tag) && /onPress=\{\(\) => \{\}\}/.test(tag);
            if (allowed.includes(rel) || (isMenu && allowed.includes(`${rel}:menu`)) || (isGuard && allowed.includes(`${rel}:serving-guard`))) continue;
            missing.push(`${rel}:${line}`);
          }
        }
      }
    };
    walk(root);
    expect(missing).toEqual([]);
  });
});

describe('V139-9: finished match cards show the date; admin screens go back to Profile', () => {
  it('a finished card shows the match date (not updatedAt); live and scheduled cards unchanged', async () => {
    const { MatchCard } = require('../MatchCard');
    const { formatDateT } = require('../../i18n/format');
    const fin = won({ id: 'f1', finishedAt: Date.UTC(2026, 9, 3, 12), updatedAt: Date.UTC(2026, 9, 9, 12), title: 'Sunday league' } as Partial<Match>);
    await render(<MatchCard m={fin} />);
    const txt = JSON.stringify(screen.getByTestId('match-card-when-f1').props.children);
    expect(txt).toContain(formatDateT(Date.UTC(2026, 9, 3, 12)));
    expect(txt).toContain('Sunday league');
    expect(txt).not.toContain(formatDateT(Date.UTC(2026, 9, 9, 12)));
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await render(<MatchCard m={fin} />);
    expect(JSON.stringify(screen.getByTestId('match-card-when-f1').props.children)).toContain(formatDateT(Date.UTC(2026, 9, 3, 12)));
    await render(<MatchCard m={{ ...base, id: 'l1' } as Match} />);
    expect(JSON.stringify(screen.getByTestId('match-card-when-l1').props.children)).not.toMatch(/2026/);
  });
  it('the header back on /admin-* opened directly goes to Profile', () => {
    const { backFallback } = require('../../services/nav');
    for (const r of ['admin-review', 'admin-daily', 'admin-feedback']) expect([r, backFallback(r)]).toEqual([r, '/profile']);
    expect(backFallback('about')).toBe('/');
  });
  it('web direct load (Home tab underneath): header back on /admin-* goes to Profile; real history is kept', () => {
    const { headerBack } = require('../../services/nav');
    const { router } = require('expo-router');
    const tabs = (active: string) => ({ name: '(tabs)', state: { index: 0, routes: [{ name: active }] } });
    headerBack('admin-review', {}, { index: 1, routes: [tabs('index'), { name: 'admin-review' }] }); // direct load
    expect(router.navigate).toHaveBeenLastCalledWith('/profile');
    expect(router.back).not.toHaveBeenCalled();
    router.canGoBack.mockReturnValue(true);
    headerBack('admin-daily', {}, { index: 1, routes: [tabs('profile'), { name: 'admin-daily' }] }); // opened from Profile
    expect(router.back).toHaveBeenCalledTimes(1);
    headerBack('admin-feedback', {}, { index: 2, routes: [tabs('profile'), { name: 'admin-review' }, { name: 'admin-feedback' }] });
    expect(router.back).toHaveBeenCalledTimes(2); // back to admin-review
    headerBack('admin-feedback', {}, { index: 0, routes: [{ name: 'admin-feedback' }] }); // nothing underneath
    expect(router.navigate).toHaveBeenCalledTimes(2);
    headerBack('about', {}, { index: 1, routes: [tabs('index'), { name: 'about' }] }); // other screens unchanged
    expect(router.back).toHaveBeenCalledTimes(3);
    router.canGoBack.mockReturnValue(false);
  });
});
