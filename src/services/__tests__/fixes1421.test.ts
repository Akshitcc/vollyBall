/** 1.4.21 regression tests (QA 1.4.20 failures) – core logic. Rendered paths: components/__tests__/fixes1421.test.tsx, teamBuilder1421.test.tsx. */
import fs from 'fs';
import path from 'path';
import { answerQuestion, buildChunks, buildIndex, retrieve } from '../../core/ask';
import { FIVB_RULES_URL, RULE_NOTES } from '../../core/ask/rulesKnowledge';
import { FAQS, searchFaqs } from '../../core/helpFaq';
import { faqUrl } from '../../core/ask';
import { checkSupportTicket, SUPPORT_MESSAGE_MAX } from '../../core/support';
import { clampVisible, visibleLength } from '../../core/text';
import { askLocally } from '../askLocal';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

const ix = buildIndex();
const root = path.join(__dirname, '..', '..', '..');

describe('V1420-1 delete account', () => {
  it.each([['how do I delete my account', 'en'], ['how do I delete my account', 'hi'], ['मैं अपना खाता कैसे हटाऊँ', 'hi'], ['मैं अपना खाता कैसे हटाऊँ', 'en'], ['delete account', 'en']] as const)('%s (%s) → account-delete only, never the tournament FAQ', (q, lang) => {
    const ids = retrieve(ix, q, lang).map((c) => c.id.replace(/:(en|hi)$/, ''));
    expect(ids[0]).toBe('faq:account-delete');
    expect(ids.some((id) => id.startsWith('faq:tour'))).toBe(false);
  });
  it('the FAQ exists in EN + HI and the Help search finds it', () => {
    const f = FAQS.find((x) => x.id === 'account-delete')!;
    expect(f.en.a).toMatch(/Contact us/);
    expect(f.hi.a.length).toBeGreaterThan(20);
    expect(searchFaqs('delete my account', 'en')[0].id).toBe('account-delete');
  });
});

describe('V1420-2 EN and HI give the same answers, each in its own language', () => {
  const qs = ['How many points win a set?', 'एक सेट कितने पॉइंट पर जीतते हैं', 'what is a libero', 'लिबेरो क्या है', 'how do I sign in', 'टीम में कितने खिलाड़ी', 'how do I delete my account', 'wallet money withdraw'];
  it.each(qs)('%s', async (q) => {
    const e = retrieve(ix, q, 'en'), h = retrieve(ix, q, 'hi');
    expect(h.map((c) => c.id.replace(/:hi$/, ''))).toEqual(e.map((c) => c.id.replace(/:en$/, '')));
    expect(e.every((c) => c.lang === 'en')).toBe(true);
    expect(h.every((c) => c.lang === 'hi')).toBe(true);
    const ah = await answerQuestion(ix, q, 'hi');
    if (!ah.idk) expect(ah.answer).toMatch(/[\u0900-\u097F]/); // HI content
  });
  it('off-topic stays "I don\'t know" in both', async () => {
    for (const l of ['en', 'hi'] as const) expect((await answerQuestion(ix, 'bitcoin price today', l)).idk).toBe(true);
  });
});

describe('V1420-6 libero → in-app FAQ; only rule-only notes open FIVB', () => {
  it('rule-libero maps to team-positions and its chunks link there in EN + HI', () => {
    expect(RULE_NOTES.find((r) => r.id === 'rule-libero')!.faq).toBe('team-positions');
    expect(FAQS.some((f) => f.id === 'team-positions')).toBe(true);
    for (const c of buildChunks().filter((x) => x.id.startsWith('rules:rule-libero'))) expect(c.url).toBe(faqUrl('team-positions'));
  });
  it.each(['en', 'hi'] as const)('%s: libero answer source opens the FAQ; set points still FIVB', async (lang) => {
    const a = await answerQuestion(ix, lang === 'en' ? 'what is a libero' : 'लिबेरो क्या है', lang);
    expect(a.sources[0].url).toBe(faqUrl('team-positions'));
    const b = await answerQuestion(ix, 'How many points win a set?', lang);
    expect(b.sources[0].url).toBe(FIVB_RULES_URL);
  });
  it('every faq mapping points at a real FAQ', () => {
    for (const r of RULE_NOTES) if (r.faq) expect(FAQS.some((f) => f.id === r.faq)).toBe(true);
  });
});

describe('V1420-4 one visible-character measure for counter, cut and check', () => {
  const hiText = 'क्षि'.repeat(2100); // 4 code points, 1 visible character each
  it('clampVisible cuts Hindi at exactly 2000 visible characters', () => {
    const r = clampVisible(hiText, SUPPORT_MESSAGE_MAX);
    expect(r.cut).toBe(true);
    expect(visibleLength(r.value)).toBe(SUPPORT_MESSAGE_MAX);
    expect(clampVisible('नमस्ते', 10)).toEqual({ value: 'नमस्ते', cut: false });
  });
  it('the server check accepts what the field allows and refuses one more', () => {
    const ok = clampVisible(hiText, SUPPORT_MESSAGE_MAX).value;
    expect(checkSupportTicket({ topic: 'other', message: ok }).message).toBe(ok);
    expect(() => checkSupportTicket({ topic: 'other', message: ok + 'क' })).toThrow(expect.objectContaining({ code: 'support_message_long' }));
  });
  it('contact.tsx counts and cuts with the same helpers; migration 0022 widens the column', () => {
    const c = fs.readFileSync(path.join(root, 'src/app/contact.tsx'), 'utf8');
    expect(c).toMatch(/visibleLength\(message\.trim\(\)\)/);
    expect(c).toMatch(/clampVisible\(raw, SUPPORT_MESSAGE_MAX\)/);
    const m = fs.readFileSync(path.join(root, 'server/migrations/0022_support_message_visible.sql'), 'utf8');
    expect(m).toMatch(/MODIFY COLUMN message VARCHAR\(8000\)/);
    expect(m).not.toMatch(/\bDROP\b/i);
  });
});

describe('V1420-3 DEPLOY rollback note for the 0020 checksum', () => {
  it('names both checksums and the fix', () => {
    const d = fs.readFileSync(path.join(root, 'docs/DEPLOY.md'), 'utf8');
    expect(d).toMatch(/Rollback and the 0020 checksum/);
    expect(d).toContain('5a5ae45554122ccd0d5ee6acd42fa2d02960501eabe58f9821da992fbccbc44a');
    expect(d).toContain('c719de6fa1abd4b2443c47b2d9f32b31510a14736ea1aa724bf61d8e1dede5b0');
  });
});

describe('cosmetic: asking while signed out', () => {
  it('is a coded, translated error', async () => {
    await expect(askLocally(null, 'how do I sign in', 'en')).rejects.toMatchObject({ code: 'ask_sign_in' });
    const E = en as unknown as { errors: { coded: Record<string, string> } }, H = hi as unknown as { errors: { coded: Record<string, string> } };
    expect(JSON.stringify(en)).toContain('Sign in to ask VolleyLive');
    expect(JSON.stringify(hi)).toContain('साइन इन करें');
    void E; void H;
  });
});
