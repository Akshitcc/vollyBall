/** 1.4.19 Help Center: FAQ data + search, support ticket validation (core), demo backend tickets, contact config. */
import { FAQ_CATEGORIES, FAQS, faqAbandonPolicyCurrent, searchFaqs } from '../../core/helpFaq';
import { checkSupportStatus, checkSupportTicket, SUPPORT_IMAGE_MAX_BYTES, SUPPORT_MESSAGE_MAX, supportImageProblem } from '../../core/support';
import { ANTI_FRAUD } from '../../core/antifraud';
import { RANKING_POINTS_PER_POTM, RANKING_POINTS_PER_WIN } from '../../core/ranking';
import { REVIEW_RULES } from '../../core/reviewPrompt';
import { MIN_PLAYERS, MAX_PLAYERS } from '../../core/roster';
import { DEFAULT_MIN_AGE } from '../../core/registration';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import { TERMS_VERSION } from '../../core/terms';
import { supportContactFrom } from '../supportContact';
import { translateCode } from '../../i18n/format';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));
const codeSync = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as { code?: string }).code; } };
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));

describe('FAQ data', () => {
  it('every category covered, unique ids, EN + HI text, tags', () => {
    expect(new Set(FAQS.map((f) => f.id)).size).toBe(FAQS.length);
    for (const c of FAQ_CATEGORIES) expect(FAQS.some((f) => f.category === c)).toBe(true);
    for (const f of FAQS) {
      for (const l of ['en', 'hi'] as const) { expect(f[l].q.length).toBeGreaterThan(5); expect(f[l].a.length).toBeGreaterThan(20); }
      expect(f.hi.a).not.toBe(f.en.a);
      expect(/[\u0900-\u097F]/.test(f.hi.a)).toBe(true);
      expect(f.tags.length).toBeGreaterThan(0);
      expect((en as any).help.cat[f.category]).toBeTruthy();
      expect((hi as any).help.cat[f.category]).toBeTruthy();
    }
  });
  it('the numbers quoted match the app (core constants)', () => {
    const a = (id: string) => FAQS.find((f) => f.id === id)!.en.a;
    expect(a('team-size')).toContain(`At least ${MIN_PLAYERS}`);
    expect(a('team-size')).toContain(`up to ${MAX_PLAYERS}`);
    expect(a('reg-profile')).toContain(`aged ${DEFAULT_MIN_AGE}`);
    expect(a('potm')).toContain(`${RANKING_POINTS_PER_POTM} ranking points`);
    expect(a('wallet-points')).toContain(`+${RANKING_POINTS_PER_WIN} ranking points per counted win`);
    expect(a('wallet-points')).toContain(`+${ANTI_FRAUD.BONUS_POINTS} bonus for every ${ANTI_FRAUD.BONUS_EVERY_WINS} counted wins`);
    expect(a('wallet-caps')).toContain(`at most ${ANTI_FRAUD.MAX_COUNTED_PER_PLAYER_PER_DAY} counted matches per day`);
    expect(a('wallet-caps')).toContain(`at most ${ANTI_FRAUD.MAX_COUNTED_PER_PAIR_PER_WEEK} per week`);
    expect(a('wallet-caps')).toContain(`shorter than ${ANTI_FRAUD.MIN_MATCH_MINUTES} minutes`);
    expect(a('feedback')).toContain(`once every ${REVIEW_RULES.COOLDOWN_DAYS} days`);
    expect(a('feedback')).toContain(`after ${REVIEW_RULES.MIN_COMPLETED} completed matches`);
    expect(faqAbandonPolicyCurrent()).toBe(true); // the abandon answer describes the interim 'review' policy
    expect(a('abandon')).toMatch(/admin review/);
    expect(a('tour-owner')).toMatch(/Only the person who created it/);
  });
  it('search: EN, HI, tags, every word, no match, empty = all', () => {
    expect(searchFaqs('abandon').map((f) => f.category)).toContain('abandon');
    expect(searchFaqs('abandon')[0].category).toBe('abandon');
    expect(searchFaqs('टूर्नामेंट', 'hi')[0].category).toBe('tournaments');
    expect(searchFaqs('OTP')[0].id).toBe('reg-signin');
    expect(searchFaqs('wallet bonus').map((f) => f.id)).toContain('wallet-points');
    expect(searchFaqs('zzqqxx')).toEqual([]);
    expect(searchFaqs('  ').length).toBe(FAQS.length);
    expect(searchFaqs('पॉइंट', 'hi').some((f) => f.category === 'wallet')).toBe(true);
  });
});

describe('core/support', () => {
  it('ticket validation', () => {
    expect(checkSupportTicket({ topic: 'bug', message: '  The app froze on scoring.  ', appVersion: '1.4.19 (35)<x>' })).toEqual({ topic: 'bug', message: 'The app froze on scoring.', appVersion: '1.4.19 (35)x' });
    expect(codeSync(() => checkSupportTicket({ topic: 'x', message: 'long enough message' }))).toBe('support_topic');
    expect(codeSync(() => checkSupportTicket({ topic: 'bug', message: 'short' }))).toBe('support_message_short');
    expect(codeSync(() => checkSupportTicket({ topic: 'bug', message: '\u200b'.repeat(20) }))).toBe('support_message_short');
    expect(codeSync(() => checkSupportTicket({ topic: 'bug', message: 'x'.repeat(SUPPORT_MESSAGE_MAX + 1) }))).toBe('support_message_long');
    expect(codeSync(() => checkSupportTicket({ topic: 'bug', message: 'x'.repeat(SUPPORT_MESSAGE_MAX) }))).toBeNull();
  });
  it('image limits and statuses', () => {
    expect(supportImageProblem('image/png', 1000)).toBeNull();
    expect(supportImageProblem('image/webp', null)).toBeNull();
    expect(supportImageProblem('image/gif', 1000)).toBe('support_image_type');
    expect(supportImageProblem(null, 1000)).toBe('support_image_type');
    expect(supportImageProblem('image/jpeg', SUPPORT_IMAGE_MAX_BYTES)).toBe('support_image_size');
    expect(supportImageProblem('image/jpeg', 0)).toBe('support_image_size');
    for (const s of ['open', 'replied', 'closed']) expect(checkSupportStatus(s)).toBe(s);
    expect(codeSync(() => checkSupportStatus('deleted'))).toBe('support_status');
  });
  it('EN / HI messages for every code', () => {
    for (const c of ['support_topic', 'support_message_short', 'support_message_long', 'support_image_type', 'support_image_size', 'support_image_exists', 'support_status']) {
      expect(translateCode({ code: c, min: 10, max: 2000 })).toBeTruthy();
      expect((hi as any).errors.codes[c]).toBeTruthy();
      expect((hi as any).errors.codes[c]).not.toBe((en as any).errors.codes[c]);
    }
  });
  it('contact links only from valid config; nothing built in', () => {
    expect(supportContactFrom({})).toEqual({ email: null, whatsapp: null });
    expect(supportContactFrom({ email: 'not an email', whatsapp: '12' })).toEqual({ email: null, whatsapp: null });
    expect(supportContactFrom({ email: ' help@example.com ', whatsapp: '+91 98765 43210' })).toEqual({ email: 'help@example.com', whatsapp: '919876543210' });
  });
});

describe('demo backend tickets', () => {
  const made: DemoBackend[] = [];
  afterEach(() => { for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer); });
  async function demo() {
    const b = new DemoBackend();
    made.push(b);
    await (b as unknown as { ready: Promise<void> }).ready;
    const inner = b as unknown as { db: { users: Record<string, unknown> }; authUser: { uid: string } | null; terms: Record<string, unknown> };
    (b as unknown as { qaAdmins: Set<string> }).qaAdmins.add(DEMO_QA_ADMIN.id); // the demo app admin, switched on
    expect(await b.isAdmin(DEMO_QA_ADMIN.id)).toBe(true);
    for (const u of Object.keys(inner.db.users)) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
    return { b, as: (u: string | null) => (inner.authUser = u ? { uid: u } : null) };
  }
  const ok = { topic: 'scoring', message: 'The score did not update after a rally.', appVersion: '1.4.19 (35)' };
  it('create saves user + version; each user lists only their own', async () => {
    const { b, as } = await demo();
    as('seed1');
    const id = await b.createSupportTicket(ok);
    as('seed2');
    await b.createSupportTicket({ ...ok, topic: 'bug' });
    expect((await b.listMySupportTickets()).map((x) => x.topic)).toEqual(['bug']);
    as('seed1');
    const mine = await b.listMySupportTickets();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, userId: 'seed1', appVersion: '1.4.19 (35)', status: 'open', screenshotUrl: null });
    as(null);
    expect(await codeOf(b.createSupportTicket(ok))).toMatch(/Not signed in/);
  });
  it('validation and screenshot limits', async () => {
    const { b, as } = await demo();
    as('seed1');
    expect(await codeOf(b.createSupportTicket({ ...ok, topic: 'nope' }))).toBe('support_topic');
    expect(await codeOf(b.createSupportTicket({ ...ok, message: 'short' }))).toBe('support_message_short');
    expect(await codeOf(b.createSupportTicket({ ...ok, screenshot: { uri: 'file:///a.gif', type: 'image/gif', size: 10 } }))).toBe('support_image_type');
    expect(await codeOf(b.createSupportTicket({ ...ok, screenshot: { uri: 'file:///a.png', type: 'image/png', size: SUPPORT_IMAGE_MAX_BYTES } }))).toBe('support_image_size');
    await b.createSupportTicket({ ...ok, screenshot: { uri: 'file:///a.png', type: 'image/png', size: 2000 } });
    expect((await b.listMySupportTickets())[0].screenshotUrl).toBe('file:///a.png');
  });
  it('admin only: list all and set status', async () => {
    const { b, as } = await demo();
    as('seed1');
    const id = await b.createSupportTicket(ok);
    as('seed2');
    await b.createSupportTicket(ok);
    for (const u of ['seed1', 'seed2']) {
      as(u);
      expect(await codeOf(b.listSupportTickets())).toBe('admin_only');
      expect(await codeOf(b.setSupportTicketStatus(id, 'closed'))).toBe('admin_only');
    }
    as(DEMO_QA_ADMIN.id);
    expect(await b.listSupportTickets()).toHaveLength(2);
    for (const st of ['replied', 'closed', 'open'] as const) {
      await b.setSupportTicketStatus(id, st);
      expect((await b.listSupportTickets()).find((x) => x.id === id)!.status).toBe(st);
    }
    expect(await codeOf(b.setSupportTicketStatus(id, 'gone' as never))).toBe('support_status');
  });
});
