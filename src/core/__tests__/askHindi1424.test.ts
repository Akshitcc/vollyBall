// 1.4.24 (QA V1423-2): "हटा" takes its subject into account; अंक → points; basic romanised Hindi.
import { buildIndex, expandQuestion, retrieve } from '../ask';

const ix = buildIndex();
const ids = (q: string) => retrieve(ix, q, 'hi').map((c) => c.id.replace(/:(en|hi)$/, ''));
const top = (q: string) => ids(q)[0];

describe('subject-aware remove (V1423-2)', () => {
  test('team removal from a match → match edit, not account delete', () => {
    expect(top('मैच से टीम कैसे हटाएँ')).toBe('faq:match-edit');
    expect(ids('मैच से टीम कैसे हटाएँ')).not.toContain('faq:account-delete');
  });
  test('photo removal never maps to account delete', () => {
    expect(ids('फ़ोटो कैसे हटाएँ')).not.toContain('faq:account-delete');
    expect(ids('फोटो डिलीट करनी है')).not.toContain('faq:account-delete');
  });
  test.each(['मैं अपना अकाउंट कैसे डिलीट करूँ', 'अकाउंट डिलीट करना है', 'मेरा खाता हटाएँ', 'account kaise hatayein'])('account removal still → account-delete: %s', (q) => {
    expect(top(q)).toBe('faq:account-delete');
  });
  test('expansion names the subject', () => {
    expect(expandQuestion('मैच से टीम कैसे हटाएँ')).toContain('remove team');
    expect(expandQuestion('मैच से टीम कैसे हटाएँ')).not.toContain('delete account');
    expect(expandQuestion('मेरा खाता हटाएँ')).toContain('delete account');
  });
});

describe('points per set + romanised Hindi', () => {
  test.each([
    ['एक सेट कितने अंकों का होता है', 'rules:rule-set-points'],
    ['set kitne point ka hota hai', 'rules:rule-set-points'],
    ['jaal chhuna foul hai kya', 'rules:rule-net'],
    ['khiladi kab ghoomte hain', 'rules:rule-rotation'],
    ['स्कोरर कौन बदल सकता है', 'faq:score-handover'],
  ])('%s → %s', (q, id) => expect(top(q)).toBe(id));
  test('plain English is not expanded', () => {
    expect(expandQuestion('what is a libero')).toBe('what is a libero');
    expect(top('what is a libero')).toBe('rules:rule-libero');
  });
});
