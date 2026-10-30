/** 1.5.9 UI: F158-8 (Space toggles the shared Checkbox; 'activate'), the daily card's Day "Tap for next" label, F158-12 demo guard. */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('../../services/backend', () => ({ backend: { listDailyItems: jest.fn(async () => []) } }));
import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import i18n from '../../i18n';
import { applyTheme } from '../../theme';
import { ThemeContext } from '../../theme/ThemeProvider';
import { tokens } from '../../theme/tokens';
import { BUNDLED_DAILY_ITEMS, pickDaily } from '../../core/dailyItems';
import { Checkbox, onCheckboxAction, webCheckboxProps } from '../Checkbox';

const ctx = (name: 'day' | 'night') => ({ name, t: tokens[name], setting: name, setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 }) as never;
const inTheme = (name: 'day' | 'night', el: React.ReactElement) => { applyTheme(name); return <ThemeContext.Provider value={ctx(name)}>{el}</ThemeContext.Provider>; };
afterEach(async () => { applyTheme('day'); await i18n.changeLanguage('en'); });

describe('F158-8: the shared Checkbox', () => {
  it('web: Space toggles (no page scroll), a held key repeats nothing, other keys do nothing; aria-checked follows', () => {
    const on = jest.fn();
    const p = webCheckboxProps(false, on);
    expect(p['aria-checked']).toBe(false);
    const pd = jest.fn();
    p.onKeyDown({ key: ' ', preventDefault: pd });
    expect(on).toHaveBeenLastCalledWith(true);
    expect(pd).toHaveBeenCalled();
    p.onKeyDown({ key: 'Spacebar' });
    expect(on).toHaveBeenCalledTimes(2);
    p.onKeyDown({ key: ' ', repeat: true });
    p.onKeyDown({ key: 'Enter' });
    p.onKeyDown({ key: 'a' });
    expect(on).toHaveBeenCalledTimes(2);
    expect(webCheckboxProps(true, on)['aria-checked']).toBe(true);
  });
  it("native: press and the 'activate' accessibility action toggle it; role / state / label", async () => {
    function Host() { const [c, setC] = useState(false); return <Checkbox checked={c} onChange={setC} label="I agree" testID="cb" />; }
    await render(<Host />);
    const cb = screen.getByTestId('cb');
    expect(cb.props.accessibilityRole).toBe('checkbox');
    expect(cb.props.accessibilityLabel).toBe('I agree');
    expect(cb.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(cb);
    expect(screen.getByTestId('cb').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent(screen.getByTestId('cb'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(screen.getByTestId('cb').props.accessibilityState).toMatchObject({ checked: false });
    const on = jest.fn();
    onCheckboxAction(false, on)({ nativeEvent: { actionName: 'longpress' } } as never);
    expect(on).not.toHaveBeenCalled();
  });
  it('disabled: no change', async () => {
    const on = jest.fn();
    await render(<Checkbox checked={false} onChange={on} label="x" testID="cb" disabled />);
    await fireEvent.press(screen.getByTestId('cb'));
    expect(on).not.toHaveBeenCalled();
  });
  it('every checkbox in the app is the shared one (no other role=checkbox)', () => {
    const root = path.resolve(__dirname, '../..');
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== '__tests__') walk(p); } else if (/\.tsx$/.test(f.name) && /accessibilityRole="checkbox"|role="checkbox"/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p)); } };
    walk(root);
    expect(hits).toEqual(['components/Checkbox.tsx']);
    expect(fs.readFileSync(path.join(root, 'app/terms.tsx'), 'utf8')).toContain('<Checkbox checked={checked} onChange={setChecked}');
  });
});

describe('daily card: "Tap for next" rotates', () => {
  const { DailyCard } = require('../DailyCard');
  const NOW = Date.UTC(2026, 9, 30, 6, 0);
  it('Day: tapping the "Tap for next" words shows the next item, then the one after (same as tapping the card)', async () => {
    await render(inTheme('day', <DailyCard now={NOW} items={BUNDLED_DAILY_ITEMS} />));
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 0)!.textEn);
    expect(screen.queryByTestId('daily-tap-next')).toBeNull(); // hidden from screen readers (the card is the one button)
    await fireEvent.press(screen.getByTestId('daily-tap-next', { includeHiddenElements: true }));
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 1)!.textEn);
    await fireEvent.press(screen.getByTestId('daily-next'));
    expect(screen.getByTestId('daily-text')).toHaveTextContent(pickDaily(BUNDLED_DAILY_ITEMS, NOW, 2)!.textEn);
    // the label is not a second screen-reader button
    expect(screen.getByTestId('daily-tap-next', { includeHiddenElements: true }).props.accessible).toBe(false);
  });
  it('the whole bundled list comes round: N taps show N different items, then it repeats', async () => {
    const n = BUNDLED_DAILY_ITEMS.filter((x) => x.active).length;
    const seen = new Set(Array.from({ length: n }, (_, i) => pickDaily(BUNDLED_DAILY_ITEMS, NOW, i)!.id));
    expect(seen.size).toBe(n);
  });
});

describe('F158-12: the demo backend refuses a 7th starter', () => {
  it('a captain setting subs to [] on the 8-player Giants is refused; moving one to subs is fine', async () => {
    const { DemoBackend } = require('../../services/backend/demoBackend');
    const b = new DemoBackend();
    await (b as { ready: Promise<void> }).ready;
    const inner = b as unknown as { db: { teams: Record<string, { memberIds: string[]; subIds: string[]; captainId: string }> }; authUser: unknown; requireTerms: () => void };
    inner.requireTerms = () => {};
    const g = inner.db.teams.team_giants;
    await expect(b.updateTeam('team_giants', { subIds: [] })).rejects.toThrow(/At most 6 starters/);
    await expect(b.updateTeam('team_giants', { subIds: [...g.subIds, g.memberIds[1]] })).resolves.toBeUndefined();
    const timers = b as unknown as { simTimer: ReturnType<typeof setInterval>; saveTimer: ReturnType<typeof setTimeout> };
    clearInterval(timers.simTimer); clearTimeout(timers.saveTimer); // as support1419: no open handles
  });
});
