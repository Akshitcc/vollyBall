import en from '../locales/en';
import hi from '../locales/hi';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();

const EN = flatten(en as unknown as Tree);
const HI = flatten(hi as unknown as Tree);

describe('translation resources', () => {
  it('en and hi have exactly the same keys (including nested keys)', () => {
    const enKeys = Object.keys(EN).sort();
    const hiKeys = Object.keys(HI).sort();
    expect(hiKeys.filter((k) => !(k in EN))).toEqual([]); // extra in hi
    expect(enKeys.filter((k) => !(k in HI))).toEqual([]); // missing in hi
    expect(hiKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(200);
  });

  it('every key uses the same interpolation placeholders in both languages', () => {
    const mismatches = Object.keys(EN)
      .filter((k) => JSON.stringify(placeholders(EN[k])) !== JSON.stringify(placeholders(HI[k])))
      .map((k) => `${k}: en=${placeholders(EN[k])} hi=${placeholders(HI[k])}`);
    expect(mismatches).toEqual([]);
  });

  it('has no empty strings', () => {
    expect(Object.entries(EN).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
    expect(Object.entries(HI).filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });

  it('Hindi strings are actually written in Devanagari (not copied English)', () => {
    // Keys whose Hindi value may legitimately contain no Devanagari.
    // liveV2.undoPlayer/undoTeam are "{{name}} −1" in every language (design: symbol only).
    // profileForm.pincodeFound (1.3.7, R136-21): only placeholders – India Post's English district/state shown as-is
    const allowed = new Set(['language.en', 'tournament.colPos', 'liveV2.undoPlayer', 'liveV2.undoTeam', 'profileForm.pincodeFound']);
    const untranslated = Object.keys(HI).filter((k) => !allowed.has(k) && !/[\u0900-\u097F]/.test(HI[k]));
    expect(untranslated).toEqual([]);
  });
});
