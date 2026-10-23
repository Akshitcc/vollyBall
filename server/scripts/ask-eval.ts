/**
 * Ask VolleyLive eval (1.5.0 set + 1.5.1 + 1.5.2 + 1.5.3 + 1.5.4 + 1.5.5 + 1.5.6 + 1.5.7 additions): runs docs/qa/ask-eval-1.5.7.jsonl against the API on a LOCAL test database with the
 * seeded world (tests/askFixtures.ts) and the MOCK provider (offline, no key), and scores every item:
 * tools called, text that must / must not appear, I-don't-know, refusals, card types, and – for every item – no phone
 * number or e-mail of anyone in the answer or the cards.
 *
 *   TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/volleylive_askeval_test npx tsx scripts/ask-eval.ts [--probe "question" ...]
 *
 * 1.5.1 world addition (F150-7): Aarav's two latest results are voided (admin) and disputed (other captain rejected);
 * they were already 'under review' and never counted, so no 1.5.0 item's stats change.
 * 1.5.2 world additions (F151-4): an admin FAQ entry with phones / e-mails in new formats AND a set-score line
 * ('scorer-desk'), and a team named with a Devanagari phone number captained by the spare player Juhu49 ("pii").
 *
 * 1.5.3 (F152-1 / F152-2): the PII check also runs the app's own masker over the display text (any digit script,
 * spaced single digits, digit words), `expect.stored` checks the user's newest ask_history / ask_audit rows, and the world
 * has a team named 'Club 9 8 7 6 5 4 3 2 1 0' (captain: the pii user).
 * Writes docs/qa/ask-eval-1.5.7-report.json (pass rate + failures). Exit code 1 below --min (default 0.9).
 */
import fs from 'node:fs';
import path from 'node:path';
import { startHarness, type Harness } from '../tests/helpers';
import { AARAV, AMAN, idOf, LONER, PRIYA, setupAskWorld, ZOYA } from '../tests/askFixtures';
import type { Identity } from '../src/auth/verifier';
import * as askDomain from '../src/domain/ask';
import { ID_KEY } from '../../src/core/ask/tools';
import { maskPii } from '../../src/core/pii';
import * as teamsDomain from '../src/domain/teams';
import { ADMIN } from '../tests/helpers';

process.env.TEST_DATABASE_URL ??= 'mysql://root@127.0.0.1:3306/volleylive_askeval_test';
const ROOT = path.resolve(__dirname, '../..');
const SET = path.join(ROOT, 'docs/qa/ask-eval-1.5.7.jsonl');
const REPORT = path.join(ROOT, 'docs/qa/ask-eval-1.5.7-report.json');

export interface EvalItem {
  id: string; cat: string; lang: 'en' | 'hi'; as: string; q: string;
  expect: { stored?: { masked?: boolean; contains?: string[]; notContains?: string[] }; tools?: string[]; noTools?: boolean; contains?: string[]; anyOf?: string[]; notContains?: string[]; idk?: boolean; refusal?: string | null; outcome?: string; cards?: string[]; sourceKind?: string };
}
const PII = [/\+?91[\s-]?[6-9]\d{4}[\s-]?\d{5}/, /(?<!\d)[6-9]\d{9}(?!\d)/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/];

export function score(it: EvalItem, r: { status: number; body: Record<string, any> }): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const f: string[] = [];
  if (r.status !== 200) return [`HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`];
  const b = r.body;
  const text = String(b.answer ?? '');
  const low = text.toLocaleLowerCase();
  const tools = (b.tools ?? []).map((t: { name: string }) => t.name) as string[];
  // 1.5.2 (F151-4): ids / routing fields are not display text and are never masked (a uuid can contain 10 digits that
  // look like a mobile) – the PII check covers the answer and every display string of the cards and sources
  const displayOnly = (k: string, v: unknown) => (ID_KEY.test(k) ? undefined : v);
  const blob = JSON.stringify({ answer: b.answer, cards: b.cards, sources: b.sources }, displayOnly);
  for (const re of PII) if (re.test(blob)) f.push(`PII in output: ${re}`);
  if (maskPii(blob) !== blob) f.push('PII in output (app masker)'); // 1.5.3: non-ASCII scripts, spaced digits, digit words
  const e = it.expect;
  if (e.tools) for (const t of e.tools) if (!tools.includes(t)) f.push(`tool ${t} not called (got ${tools.join(',') || 'none'})`);
  if (e.noTools && tools.length) f.push(`tools called: ${tools.join(',')}`);
  for (const c of e.contains ?? []) if (!low.includes(c.toLocaleLowerCase())) f.push(`missing "${c}"`);
  if (e.anyOf && !e.anyOf.some((c) => low.includes(c.toLocaleLowerCase()))) f.push(`none of ${JSON.stringify(e.anyOf)}`);
  for (const c of e.notContains ?? []) if (blob.toLocaleLowerCase().includes(c.toLocaleLowerCase())) f.push(`must not contain "${c}"`);
  if (e.idk !== undefined && !!b.idk !== e.idk) f.push(`idk ${!!b.idk} ≠ ${e.idk}`);
  if (e.refusal !== undefined && (b.refusal ?? null) !== e.refusal) f.push(`refusal ${b.refusal} ≠ ${e.refusal}`);
  if (e.outcome && b.outcome !== e.outcome) f.push(`outcome ${b.outcome} ≠ ${e.outcome}`);
  for (const c of e.cards ?? []) if (!(b.cards ?? []).some((x: { type: string }) => x.type === c)) f.push(`no ${c} card`);
  if (e.sourceKind && !(b.sources ?? []).some((s: { kind: string }) => s.kind === e.sourceKind)) f.push(`no ${e.sourceKind} source`);
  return f;
}

/** 1.5.3 (F152-1 / F152-2): what the server KEPT for this turn (newest ask_history + ask_audit rows of the user). */
async function scoreStoredWith(db: Harness['db'], it: EvalItem, id: Identity): Promise<string[]> {
  const f: string[] = [];
  const e = it.expect.stored!;
  const hist = await db('ask_history').where({ user_id: id.uid }).orderBy('id', 'desc').first();
  const audit = await db('ask_audit').where({ user_id: id.uid }).orderBy('id', 'desc').first();
  for (const [name, v] of [['history', hist?.question], ['audit', audit?.question], ['audit tools', audit?.tools]] as const) {
    const t = String(v ?? '');
    if (e.masked && name !== 'audit tools' && !t.includes('[phone hidden]')) f.push(`${name}: not masked (${t.slice(0, 80)})`);
    for (const c of e.notContains ?? []) if (t.toLocaleLowerCase().includes(c.toLocaleLowerCase())) f.push(`${name} keeps "${c}"`);
    if (name !== 'audit tools') for (const c of e.contains ?? []) if (!t.includes(c)) f.push(`${name} lost "${c}"`);
  }
  return f;
}
let scoreStored: (it: EvalItem, id: Identity) => Promise<string[]> = async () => [];

async function main() {
  const args = process.argv.slice(2);
  const min = Number(args[args.indexOf('--min') + 1]) || 0.9;
  const h: Harness = await startHarness();
  try {
    const world = await setupAskWorld(h);
    scoreStored = (it, id) => scoreStoredWith(h.db, it, id);
    const who: Record<string, Identity> = { aarav: AARAV, priya: PRIYA, zoya: ZOYA, juhu: world.juhuViewer, kabir: idOf('seed4'), aman: AMAN, loner: LONER, pii: { uid: 'Juhu49', phone: '+919400000048' } };
    const ask = async (as: string, q: string, lang: string) => {
      h.s.rateLimiter?.reset();
      const r = await h.as(who[as] ?? AARAV).post('/api/ask/chat').send({ question: q, lang });
      return { status: r.status, body: r.body };
    };
    {
      const r = await ask('aarav', 'What are my last results?', 'en');
      const ids = ((r.body.cards?.[0]?.items ?? []) as { matchId: string }[]).map((i) => i.matchId);
      if (ids.length < 2) throw new Error('eval world: expected Aarav to have finished matches');
      await h.db('matches').where({ id: ids[0] }).update({ verification_status: 'voided' });
      await h.db('matches').where({ id: ids[1] }).update({ verification_status: 'disputed', captain_verdict: 'rejected' });
      await askDomain.putContent(h.s, ADMIN, 'scorer-desk', {
        lang: 'en', title: 'Scorer desk ９८१२३४५६२०',
        text: 'The scorer desk helps captains with score sheets. Call ９８１２３４５６２０ or ९८१२३४५६२१ or +91 (98123) 45623, mail bookings@exämple.com or desk＠example.com. Example score sheet line: 8-6 5-7 9-7 6-8 8-6.',
      });
      await teamsDomain.createTeam(h.s, who.pii, { name: 'Call ९८१२३४५६३१ XI', color: '#225588', captainId: who.pii.uid, memberIds: [who.pii.uid], subIds: [], pendingPhones: [] }, 'team_70901100-48f2-4fbf-81f3-8196753097dd');
      // 1.5.3 (F152-1): a team named with spaced single digits (phone-shaped) – masked in answers and cards
      await teamsDomain.createTeam(h.s, who.pii, { name: 'Club 9 8 7 6 5 4 3 2 1 0', color: '#663399', captainId: who.pii.uid, memberIds: [who.pii.uid], subIds: [], pendingPhones: [] }, 'team_1530aa00-48f2-4fbf-81f3-9876543210aa');
      await h.db('ask_audit').del();
    }
    const pi = args.indexOf('--probe');
    if (pi >= 0) {
      for (const q of args.slice(pi + 1)) {
        const [as, lang, text] = q.includes('|') ? q.split('|') : ['aarav', 'en', q];
        const r = await ask(as, text, lang);
        console.log(`\n### [${as}/${lang}] ${text}\n${JSON.stringify({ answer: r.body.answer, tools: r.body.tools?.map((t: { name: string }) => t.name), idk: r.body.idk, refusal: r.body.refusal, outcome: r.body.outcome, cards: r.body.cards?.map((c: { type: string }) => c.type), sources: r.body.sources?.map((s: { id: string }) => s.id) })}`);
      }
      console.log('\nworld:', JSON.stringify({ champion: world.groups.champion && world.groups.names[world.groups.champion], tables: world.groups.tables.map((t) => `${t.group}: ${t.order.map((x) => world.groups.names[x]).join(' > ')}`) }));
      return;
    }
    const items: EvalItem[] = fs.readFileSync(SET, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const results: { id: string; cat: string; ok: boolean; fails: string[]; answer: string }[] = [];
    for (const it of items) {
      const r = await ask(it.as, it.q, it.lang);
      const fails = score(it, r);
      if (it.expect.stored && r.status === 200) fails.push(...(await scoreStored(it, who[it.as] ?? AARAV)));
      results.push({ id: it.id, cat: it.cat, ok: !fails.length, fails, answer: String(r.body.answer ?? '').slice(0, 160) });
    }
    const passed = results.filter((x) => x.ok).length;
    const byCat: Record<string, { n: number; pass: number }> = {};
    for (const x of results) { const c = (byCat[x.cat] ??= { n: 0, pass: 0 }); c.n++; if (x.ok) c.pass++; }
    const audit = await h.db('ask_audit').count({ n: '*' });
    const report = { set: 'docs/qa/ask-eval-1.5.7.jsonl', provider: 'mock', items: results.length, passed, passRate: Number((passed / results.length).toFixed(4)), byCategory: byCat, auditRows: Number(audit[0].n), failures: results.filter((x) => !x.ok) };
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(`ask-eval: ${passed}/${results.length} passed (${(100 * passed / results.length).toFixed(1)}%)`);
    for (const [c, v] of Object.entries(byCat)) console.log(`  ${c.padEnd(12)} ${v.pass}/${v.n}`);
    for (const x of report.failures) console.log(`  FAIL ${x.id}: ${x.fails.join('; ')} | ${x.answer}`);
    if (passed / results.length < min) process.exitCode = 1;
  } finally {
    await h.close();
  }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
