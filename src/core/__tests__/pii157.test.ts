/**
 * 1.5.7 (Tester F156-1 / F156-3 / F156-4): groupings with a 1-digit group ("9-876543210", "9.876.543.210",
 * "987654321-0", "+91 9-876543210") are masked; display, bubble and response use EXACTLY the stored masker; the
 * Tester's full grouping × separator × prefix matrix (14 × 56 × 9 × bare / sentence = 14 112 rows) has 0 failures; a
 * phone cue before OR after a run overrides the list / IPv4 / time exceptions; a score prefix + digit tail that totals a
 * 10-digit phone is masked.
 */
import { maskPii, maskPiiStored, normalizeForPii } from '../pii';
import { filterPii } from '../ask/tools';

const HIDDEN = /\[phone hidden\]/;
const left = (m: string) => normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text.replace(/[^0-9]/g, '');
const both = (s: string) => [maskPii(s), maskPiiStored(s)];

const N = '9876543210';
const GROUPINGS = [[5, 5], [2, 3, 5], [4, 6], [6, 4], [3, 3, 4], [1, 9], [9, 1], [2, 2, 2, 2, 2], [3, 4, 3], [4, 3, 3], [2, 4, 4], [2, 2, 3, 3], [1, 3, 3, 3], [10]];
const SEPS = ['-', ' ', '.', '/', '|', '#', '*', '~', '+', '_', ',', ';', ':', '•', '·', '–', '—', '‐', '−', '\\', "'", '"', '=', '^', '@', '!', '?', '&', '%', '$', '€', '₹', '¤', '¦', '§', '¶', '†', '→', '←', '★', '☎', '📞', '👉', '✓', '°', '×', '÷',
  '\u00a0', '\t', '\n', '\u200b', '\u2009', '\u3000', ' - ', ' | ', '----------'];
const PREFIXES = ['', '+91', '91', '0', '+91 ', '+91-', '0091', '091', '(+91) '];
const build = (g: number[], sep: string) => { let i = 0; return g.map((k) => { const x = N.slice(i, i + k); i += k; return x; }).join(sep); };

describe('F156-1: the Tester\'s one-digit groupings', () => {
  it.each(['call me 9-876543210', 'whatsapp 9-876-543-210', '9.876.543.210', '987654321-0', '+91 9-876543210', '9 876543210', 'ring 9.876.543.210', 'call +91 9-876543210', 'call 987654321-0'])('%j is masked in display AND stored', (s) => {
    for (const m of both(s)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
    expect(maskPii(s)).toBe(maskPiiStored(s));
    expect(filterPii({ text: s }).text).toBe(maskPiiStored(s));
  });
});

describe('F156-1: grouping × separator × prefix matrix (14 112 rows)', () => {
  it('every row is masked in display and stored, nothing left over', () => {
    expect(SEPS).toHaveLength(56);
    const bad: string[] = [];
    let rows = 0;
    for (const g of GROUPINGS) for (const sep of SEPS) for (const pre of PREFIXES) {
      const body = build(g, sep);
      for (const s of [pre + body, `please call me on ${pre}${body} about my teams`]) {
        rows++;
        for (const m of both(s)) if (!HIDDEN.test(m) || left(m) !== '') { bad.push(`${JSON.stringify(s)} → ${JSON.stringify(m)}`); break; }
      }
    }
    expect(rows).toBe(14_112);
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('F156-1: display = stored', () => {
  it.each(['9 876543210', '1 2 3 4 5 6 7 8 9 0', 'ref 1|2|3|4|5|6|7|8|9|0', 'points 2 2 2 2 3 9 0 5 8 2 0 5', 'Final 25-23 25-20 15-13', 'sets 8-6 5-7 9-7 6-8 8-6', 'call 98765 43210'])('%j: maskPii === maskPiiStored', (s) => {
    expect(maskPii(s)).toBe(maskPiiStored(s));
  });
});

describe('F156-3: a phone cue overrides the list / IPv4 / time exceptions', () => {
  it.each(['Jersey 98 | 76 | 54 | 32 | 10 is my number', 'Jersey 98 | 76 | 54 | 32 | 10 – my no.', 'Seeds: 98, 76, 54, 32, 10 … my number', 'call me 98.212.143.21', 'call me 98.76.200.123', '+91 98.212.143.21 call me',
    'call 98.76.54.32 10', '98.76.54.32 10 is my number', 'my number: 09:87:65:43:21', 'Players 98, 76, 54, 32, 10 – whatsapp me'])('%j → masked', (s) => {
    for (const m of both(s)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it.each(['Jersey 98 | 76 | 54 | 32 | 10', 'Seeds: 98, 76, 54, 32, 10', '0.0.0.0 | 64.120.64.128', '9.255.143.210', '06:30, 07:45, 09:00', '10.0.0.1:8080', 'Final 3-2 (25-23, 25-20, 25-18)',
    'Jersey 7 | 9 | 12 is my number', 'court 10.0.0.1 – call me later'])('%j stays (no cue, or not phone-shaped)', (s) => {
    expect(both(s)).toEqual([s, s]);
  });
});

describe('F156-4: trailing cues; score prefix + digit tail', () => {
  it.each(['9-7 7-9 9-6 6-9 9-7 is my number', '9-7 7-9 9-6 6-9 9-7 call me', '9-7 7-9 9-6 6-9 9-7 (whatsapp)', '9-7 7-9 9-6 6-9 9-7 mera number hai', '9-7 7-9 9-6 6-9 9-7 👈 call',
    '9-7 6-9 9-5 4321', 'sets 9-7 6-9 9-5 4321 ok'])('%j → masked', (s) => {
    for (const m of both(s)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it.each(['9-7 7-9 9-6 6-9 9-7', 'we won 8-6 5-7 9-7 6-8 8-6, number one!', 'sets 9-7 6-9 9-5 7-9 5-3 then we called it a day', '9-7 9-6 6543', 'sets 8-6 5-7 9-7 6-8 8-6 – number of sets: 5'])('%j stays', (s) => {
    expect(both(s)).toEqual([s, s]);
  });
});
