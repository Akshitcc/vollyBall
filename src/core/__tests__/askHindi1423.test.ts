// 1.4.23 (QA V1422-7): Hindi Ask questions retrieve the right source (Devanagari + everyday Hinglish words).
import { buildIndex, expandQuestion, retrieve } from '../ask';

const ix = buildIndex();
const top = (q: string, lang: 'en' | 'hi' = 'hi') => retrieve(ix, q, lang)[0]?.id.replace(/:(en|hi)$/, '');

const CASES: Array<[string, string]> = [
  ['मैं अपना अकाउंट कैसे डिलीट करूँ', 'faq:account-delete'], // tester screenshot 1422_4 …devanagari_delete_wrong_faq
  ['अकाउंट डिलीट करना है', 'faq:account-delete'],
  ['मेरा खाता हटाएँ', 'faq:account-delete'],
  ['मैच का स्कोर कैसे होता है', 'faq:score-how'], // tester screenshot 1422_4 …match_scored_wrong_answer
  ['मैच का स्कोर कैसे रखें', 'faq:score-how'],
  ['स्कोरिंग कैसे करें', 'faq:score-how'],
  ['एक सेट कितने पॉइंट का होता है', 'rules:rule-set-points'],
  ['लिबेरो क्या है', 'rules:rule-libero'],
  ['टीम कैसे बनाएँ', 'faq:team-create'],
  ['प्लेयर ऑफ़ द मैच कैसे चुना जाता है', 'faq:potm'],
  ['मैच छोड़ना है', 'faq:abandon'],
  ['नेट की ऊंचाई', 'rules:rule-net-height'],
  ['मुझे कितने पॉइंट मिलते हैं', 'faq:wallet-points'],
];

describe('Hindi Ask retrieval (V1422-7)', () => {
  test.each(CASES)('%s → %s', (q, id) => {
    expect(top(q, 'hi')).toBe(id);
    expect(top(q, 'en')).toBe(id); // the same source from the English app
  });
  test('Hindi answer chunk is returned in the Hindi app', () => {
    expect(retrieve(ix, 'मैं अपना अकाउंट कैसे डिलीट करूँ', 'hi')[0].id).toBe('faq:account-delete:hi');
  });
  test('delete question does not cite sign-in', () => {
    expect(retrieve(ix, 'मैं अपना अकाउंट कैसे डिलीट करूँ', 'hi').map((c) => c.id)).not.toContain('faq:reg-signin:hi');
  });
  test('English questions unchanged', () => {
    expect(top('how do I delete my account', 'en')).toBe('faq:account-delete');
    expect(top('How is a match scored?', 'en')).toBe('faq:score-how');
    expect(expandQuestion('how do I delete my account')).toBe('how do I delete my account');
  });
});
