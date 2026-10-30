/** 1.5.8 (Tester F157u-3): every built-in Ask source has a Hindi title, and the Hindi UI shows it. */
import { buildChunks, localSourceTitle, sourceOf } from '../ask';

const DEVANAGARI = /[\u0900-\u097F]/;

describe('F157u-3 Ask source titles in Hindi', () => {
  const chunks = buildChunks().filter((c) => c.kind !== 'custom');
  const ids = [...new Set(chunks.map((c) => sourceOf(c).id))];
  it('every FAQ / rule note / guide source has an EN and a HI title', () => {
    expect(ids.length).toBeGreaterThan(30);
    for (const id of ids) {
      const s = { id, kind: id.split(':')[0] as never, title: '' };
      const hi = localSourceTitle(s, 'hi');
      const en = localSourceTitle(s, 'en');
      expect([id, !!hi && DEVANAGARI.test(hi)]).toEqual([id, true]);
      expect([id, !!en && !DEVANAGARI.test(en)]).toEqual([id, true]);
    }
  });
  it("an English chunk's source is shown with the Hindi title in the Hindi UI (the Tester's wallet example)", () => {
    const en = chunks.find((c) => c.lang === 'en' && c.title === 'How do points and the wallet work?')!;
    const s = sourceOf(en);
    expect(s.title).toBe('How do points and the wallet work?');
    const hi = localSourceTitle(s, 'hi');
    expect(DEVANAGARI.test(hi)).toBe(true);
    expect(localSourceTitle(s, 'en')).toBe('How do points and the wallet work?');
  });
  it('custom (admin-edited) sources keep their own title', () => {
    expect(localSourceTitle({ id: 'custom:abc', kind: 'custom', title: 'Court rules' }, 'hi')).toBe('Court rules');
  });
});
