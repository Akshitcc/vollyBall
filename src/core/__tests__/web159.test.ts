/** 1.5.9 (Tester F158-7): the web boot screen follows the SAVED theme (inline script in public/index.html) + logo. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { THEME_KEY } from '../../theme/ThemeProvider';

const root = path.resolve(__dirname, '../../..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

function boot(stored: unknown, hour: number) {
  const attrs: Record<string, string> = {};
  const metas = [0, 1].map(() => ({ a: { content: 'x', media: 'm' } as Record<string, string>, setAttribute(k: string, v: string) { this.a[k] = v; }, removeAttribute(k: string) { delete this.a[k]; } }));
  const RealDate = Date;
  class FakeDate extends RealDate { constructor() { super(2026, 9, 30, hour, 30, 0); } }
  vm.runInNewContext(script, {
    window: { localStorage: { getItem: (k: string) => (k === THEME_KEY && stored !== undefined ? (typeof stored === 'string' ? stored : JSON.stringify(stored)) : null) } },
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } }, querySelectorAll: () => metas },
    Date: FakeDate,
    JSON, Object,
  });
  return { theme: attrs['data-vl-theme'], meta: metas.map((m) => m.a.content), media: metas.map((m) => m.a.media) };
}

describe('F158-7 web boot theme', () => {
  it('uses the key ThemeProvider saves under', () => expect(script).toContain(`'${THEME_KEY}'`));
  it('a saved Day choice wins at night; a saved Night choice wins at noon', () => {
    expect(boot({ setting: 'day' }, 21).theme).toBe('day');
    expect(boot({ setting: 'night' }, 12).theme).toBe('night');
  });
  it('the one account that saved a choice is used when there is no device default', () => {
    expect(boot({ users: { u1: { setting: 'day', animate: true } } }, 22).theme).toBe('day');
    // two accounts that disagree -> Auto
    expect(boot({ users: { u1: { setting: 'day' }, u2: { setting: 'night' } } }, 12).theme).toBe('day');
  });
  it('nothing saved -> Auto by the device clock (Day 06:00-18:00), the same rule as resolve.ts', () => {
    expect(boot(undefined, 5).theme).toBe('night');
    expect(boot(undefined, 6).theme).toBe('day');
    expect(boot(undefined, 17).theme).toBe('day');
    expect(boot(undefined, 18).theme).toBe('night');
  });
  it('the browser bar colour follows it', () => {
    const r = boot({ setting: 'day' }, 23);
    expect(r.meta).toEqual(['#FFFAF3', '#FFFAF3']);
    expect(r.media).toEqual([undefined, undefined]);
  });
  it('unreadable storage leaves the system-scheme colours (no throw)', () => {
    expect(boot('{not json', 12).theme).toBeUndefined();
  });
  it('the logo is shipped and shown in #root (replaced by the first render)', () => {
    expect(fs.existsSync(path.join(root, 'public/boot-logo.png'))).toBe(true);
    expect(html).toContain('<div id="vl-boot" aria-hidden="true"><img src="/boot-logo.png"');
    expect(html).toMatch(/html\[data-vl-theme="night"\][\s\S]*#1E2A44/);
  });
});
