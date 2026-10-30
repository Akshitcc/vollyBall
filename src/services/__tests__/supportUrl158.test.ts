/** 1.5.8 (Tester F157u-1): the Help Center support website comes from EXPO_PUBLIC_SUPPORT_URL; the placeholder never ships. */
import fs from 'node:fs';
import path from 'node:path';
import { supportContactFrom, supportUrlFrom } from '../supportContact';

describe('F157u-1 support URL', () => {
  it('unset / not https / placeholders -> no link', () => {
    for (const v of [undefined, null, '', '  ', 'http://help.volleylive.in', 'https://www.contact.com', 'https://contact.com/', 'https://example.com', 'javascript:alert(1)', 'https://', 'ftp://x.in'])
      expect(supportUrlFrom(v as string | undefined)).toBeNull();
    expect(supportContactFrom({}).url).toBeNull();
  });
  it('a real https URL is kept', () => {
    expect(supportUrlFrom(' https://help.volleylive.in/support ')).toBe('https://help.volleylive.in/support');
    expect(supportContactFrom({ url: 'https://help.volleylive.in' }).url).toBe('https://help.volleylive.in');
  });
  it('no placeholder support URL is built into the app source', () => {
    const src = path.join(__dirname, '../../');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
        else if (/\.(ts|tsx)$/.test(e.name) && /https:\/\/(www\.)?contact\.com/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    walk(src);
    expect(hits).toEqual([]);
  });
});
