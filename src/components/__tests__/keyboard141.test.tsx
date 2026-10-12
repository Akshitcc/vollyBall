/**
 * @jest-environment jsdom
 *
 * 1.4.1 (QA V140-11): a BEHAVIOURAL keyboard test on react-native-web (the web build's renderer), not just
 * "the role is declared": Enter and Space on a pressable card fire onPress. 1.4.0's cards were role "link",
 * which react-native-web leaves to the browser (only a real <a href> gets a click), so nothing happened –
 * the second test pins that down. A source scan keeps role "link" / "imagebutton" out of the app.
 */
import fs from 'fs';
import path from 'path';
import React, { act } from 'react';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot: (el: Element) => { render: (n: React.ReactNode) => void; unmount: () => void } };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RNW = require('react-native-web/dist/cjs/index.js') as typeof import('react-native');
import { PRESSABLE_CARD_ROLE } from '../a11yRoles';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(role: string) {
  const onPress = jest.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      React.createElement(RNW.Pressable, { accessibilityRole: role, onPress, testID: 'card' } as object, React.createElement(RNW.Text, null, 'Smashers v Blockers')),
    );
  });
  const el = host.querySelector('[data-testid="card"]') as HTMLElement;
  return { el, onPress, done: () => act(() => root.unmount()) };
}
/**
 * Keyboard like a browser: jsdom fires the key events but has no "activation behaviour", so the default action
 * the browser adds is replayed here exactly as the HTML spec has it – Enter on a <button> or <a href> clicks on
 * keydown, Space on a <button> clicks on keyup, unless a handler called preventDefault. Nothing else clicks.
 */
function key(el: HTMLElement, k: string) {
  act(() => {
    el.focus();
    const tag = el.tagName;
    const down = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    if (!down.defaultPrevented && k === 'Enter' && (tag === 'BUTTON' || (tag === 'A' && el.hasAttribute('href')))) el.click();
    const up = new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true });
    el.dispatchEvent(up);
    if (!up.defaultPrevented && k === ' ' && tag === 'BUTTON') el.click();
  });
}

describe('V140-11: keyboard on pressable cards (react-native-web)', () => {
  it('the card role used by <Card> is focusable and Enter / Space fire onPress', () => {
    expect(PRESSABLE_CARD_ROLE).toBe('button');
    const { el, onPress, done } = mount(PRESSABLE_CARD_ROLE);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.tabIndex).toBe(0);
    expect(el.tagName).toBe('BUTTON'); // react-native-web renders a native button: the browser does the keyboard
    key(el, 'Enter');
    expect(onPress).toHaveBeenCalledTimes(1);
    key(el, ' ');
    expect(onPress).toHaveBeenCalledTimes(2);
    done();
  });

  it('(why) role "link" without an href: react-native-web ignores Enter – the 1.4.0 bug', () => {
    const { el, onPress, done } = mount('link');
    key(el, 'Enter');
    expect(onPress).not.toHaveBeenCalled();
    done();
  });

  it('no pressable in the app uses role "link" or "imagebutton"', () => {
    const root = path.join(__dirname, '../..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.name === '__tests__' || f.name === 'node_modules') continue;
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.tsx$/.test(f.name)) files.push(p);
      }
    };
    walk(root);
    const bad = files.filter((f) => /accessibilityRole=["{']+(link|imagebutton)|role=["']link/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
