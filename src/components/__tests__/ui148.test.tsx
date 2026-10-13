/**
 * 1.4.8 UI (QA V147): V147-2 admin repair card (EN/HI), V147-3 one abandon score everywhere (shared formatter),
 * V147-4 web focused-input lookup, V147-5 Hindi Void ≠ Cancel, V147-6 covered in ui147 (zone label, test:tz).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import { presetRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockRepair = jest.fn(async () => undefined);
jest.mock('../../services/backend', () => ({ backend: { repairVerdict: (...a: unknown[]) => (mockRepair as (...x: unknown[]) => unknown)(...a) } }));
const mockConfirm = jest.fn(async () => true);
jest.mock('../../services/dialogs', () => ({ confirmAsk: (...a: unknown[]) => (mockConfirm as (...x: unknown[]) => unknown)(...a), notify: jest.fn() }));

import { abandonedLine, abandonScoreOf, scoreText } from '../AbandonPanel';
import { VerdictRepairCard, resetRepairedForTests } from '../VerdictRepairCard';
afterEach(() => resetRepairedForTests());
import { webFocusedInput } from '../KeyboardAwareScreen';
import { abandonedAt } from '../../core/abandon';

const i18n = require('../../i18n').default;
const WR = { ...presetRules('indoor'), bestOf: 3 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id.toUpperCase() })) });
const match = (points: string, over: Partial<Match> = {}): Match => {
  let ev: Match['events'] = [];
  for (const s of points) ev = addPoint(WR, ev, s as 'A' | 'B', { at: 1 });
  return {
    id: 'm', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' }, createdBy: 'cap', scorerId: 'cap',
    participantIds: [...A, ...B], status: 'abandoned', events: ev, maxEvents: ev.length, startedAt: 1, finishedAt: 2, interestedIds: [], updatedAt: 1, createdAt: 1, ...over,
  } as unknown as Match;
};

describe('V147-3: one abandon score (card line, panel, admin confirm, scorer dialog)', () => {
  it.each([
    ['en', 'Abandoned after set 1 · sets 1–0 (5‑3)', 'after set 1 · sets 1–0 (5‑3)', 'Abandoned at 1–2 in set 2 · sets 1–0 (5‑3)', 'at 1–2 in set 2 · sets 1–0 (5‑3)'],
    ['hi', 'सेट 1 के बाद छोड़ा गया · सेट 1–0 (5‑3)', 'सेट 1 के बाद · सेट 1–0 (5‑3)', 'सेट 2 में 1–2 पर छोड़ा गया · सेट 1–0 (5‑3)', 'सेट 2 में 1–2 पर · सेट 1–0 (5‑3)'],
  ])('%s: between sets and mid-set, the same numbers and brackets everywhere', async (lang, cardBetween, scoreBetween, cardMid, scoreMid) => {
    await i18n.changeLanguage(lang);
    const t = i18n.t.bind(i18n);
    const between = match('AABBABAA'); // set 1 to A 5–3, nothing in set 2 – 1.4.7's panel said "at 0–0 in set 2"
    expect(abandonedLine(between, t)).toBe(cardBetween);
    expect(scoreText(between, t)).toBe(scoreBetween);
    expect(scoreText(between, t)).not.toMatch(/0–0 (in set|पर)/);
    const mid = match('AABBABAAABB');
    expect(abandonedLine(mid, t)).toBe(cardMid);
    expect(scoreText(mid, t)).toBe(scoreMid);
    // the scorer's dialog (score.tsx) uses the same formatter on the live events
    expect(t('abandon.stopsAt', { score: abandonScoreOf(abandonedAt(mid), t) })).toContain(scoreMid);
    // the panel line and the admin confirm embed it
    expect(t('abandon.abandonedBy', { name: 'X', score: scoreText(between, t) })).toContain(scoreBetween);
    expect(t('abandon.confirm.confirm_abandon', { score: scoreText(between, t) })).toContain(scoreBetween);
  });
});

describe('V147-5: Hindi Void ≠ Cancel', () => {
  it('every Void label differs from Cancel ("रद्द करें") and uses अमान्य', () => {
    const cancel = hi.common.cancel;
    for (const v of [hi.abandon.actions.void, hi.verify.voidShort, hi.verify.void, hi.verify.voided]) {
      expect(v).not.toContain('रद्द');
      expect(v).toContain('अमान्य');
      expect(v).not.toBe(cancel);
    }
    expect(cancel).toBe('रद्द करें');
  });
});

describe('V147-1/2 texts (EN/HI parity)', () => {
  it('the new error codes and the repair texts exist in both languages with the same placeholders', () => {
    const ph = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();
    const L = [en, hi] as unknown as { errors: { codes: Record<string, string> }; abandon: Record<string, unknown> & { repairAsk: Record<string, string> } }[];
    for (const c of ['match_no_verdict', 'repair_invalid', 'repair_not_needed']) {
      expect(L[0].errors.codes[c]).toBeTruthy();
      expect(L[1].errors.codes[c]).toBeTruthy();
    }
    for (const k of ['repairTitle', 'repairHint', 'repairScorer', 'repairConfirmer', 'repairedToast', 'stopsAt']) expect(ph(L[1].abandon[k] as string)).toBe(ph(L[0].abandon[k] as string));
    for (const k of ['scorer', 'confirmer']) expect(ph(L[1].abandon.repairAsk[k])).toBe(ph(L[0].abandon.repairAsk[k]));
  });
});

describe('V147-2: admin repair card', () => {
  const broken = () => match('AAAAA', { status: 'finished', scorerId: 'b1', playerOfMatchId: 'a1' } as Partial<Match>);
  it.each(['en', 'hi'])('%s: offers the valid scorers, asks, then repairs', async (lang) => {
    await i18n.changeLanguage(lang);
    mockRepair.mockClear();
    mockConfirm.mockClear();
    await render(<VerdictRepairCard match={broken()} meId="adm" isAdmin nameOf={(id) => id.toUpperCase()} />);
    expect(screen.getByText(i18n.t('abandon.repairTitle'))).toBeTruthy();
    expect(screen.queryByTestId('verdict-repair-scorer-b2')).toBeNull(); // still nobody to confirm
    await fireEvent.press(screen.getByTestId('verdict-repair-scorer-a1'));
    expect(mockConfirm).toHaveBeenCalledWith(i18n.t('abandon.repairAsk.scorer', { name: 'A1' }), expect.objectContaining({ title: i18n.t('abandon.repairTitle') }));
    expect(mockRepair).toHaveBeenCalledWith('m', { scorerId: 'a1' });
    expect(await screen.findByTestId('verdict-repair-done')).toHaveTextContent(i18n.t('abandon.repairedToast'));
  });
  it('hidden for a non-admin, the admin\'s own match, and a match someone can confirm', async () => {
    await i18n.changeLanguage('en');
    const r1 = await render(<VerdictRepairCard match={broken()} meId="b3" isAdmin={false} nameOf={() => undefined} />);
    expect(r1.queryByTestId('verdict-repair')).toBeNull();
    const r2 = await render(<VerdictRepairCard match={broken()} meId="a2" isAdmin nameOf={() => undefined} />);
    expect(r2.queryByTestId('verdict-repair')).toBeNull();
    const r3 = await render(<VerdictRepairCard match={match('AAAAA', { status: 'finished' } as Partial<Match>)} meId="adm" isAdmin nameOf={() => undefined} />);
    expect(r3.queryByTestId('verdict-repair')).toBeNull();
  });
});

describe('V147-4: the web keyboard reveal finds the DOM-focused input', () => {
  const g = globalThis as unknown as { document?: unknown };
  const had = 'document' in g;
  const old = g.document;
  afterEach(() => {
    if (had) g.document = old;
    else delete g.document;
  });
  it('an INPUT / TEXTAREA is returned, anything else is not', () => {
    const input = { tagName: 'INPUT', getBoundingClientRect: () => ({ top: 0, bottom: 1 }) };
    g.document = { activeElement: input };
    expect(webFocusedInput()).toBe(input);
    g.document = { activeElement: { tagName: 'TEXTAREA' } };
    expect(webFocusedInput()).toBeTruthy();
    g.document = { activeElement: { tagName: 'BODY' } };
    expect(webFocusedInput()).toBeNull();
  });
  it('KeyboardAwareScreen reveals again once the keyboard inset is laid out', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../KeyboardAwareScreen.tsx'), 'utf8');
    expect(src).toMatch(/\[webInset, revealFocused\]/);
    expect(src).toMatch(/webFocusedInput\(\)/);
  });
});
