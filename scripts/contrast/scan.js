// VolleyLive automated contrast check (1.4.23, QA V1422-4).
// Renders every route, plus the modals, menus, dialogs and states listed in ACTIONS, in Day and Night × EN and HI,
// on the web build, and checks each visible text element against WCAG AA: 4.5:1, or 3:1 for large text
// (≥24 px, or ≥18.66 px bold). The background is what is actually painted under the text: the paint stack from
// document.elementsFromPoint at the text's centre, composited bottom-up (so absolute overlays, sheets and dialogs
// count, and a dimmed/disabled element's opacity counts against its text).
// Text over an image, gradient or map tile can't be measured from CSS; it is listed as "unmeasured" (not a pass).
// Exit code 1 when any measured text is below AA. Usage: BASE=http://127.0.0.1:8099 node scan.js [--only=/route]
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/home/box/tools/ms-playwright';
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const OUT = process.env.OUT || '/tmp/contrast';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const THEMES = (process.env.THEMES || 'day,night').split(',');
const LANGS = (process.env.LANGS || 'en,hi').split(',');

const ROUTES = [
  '/(tabs)', '/(tabs)/map', '/(tabs)/profile', '/(tabs)/score', '/(tabs)/tournaments', '/about', '/admin-daily', '/admin-feedback',
  '/admin-review', '/appearance', '/ask', '/challenge/new', '/contact', '/courts', '/court/new', '/edit-profile', '/feedback',
  '/help', '/licenses', '/match/new', '/memories', '/privacy', '/rankings', '/team/new', '/teams', '/terms-view',
  '/tournament/new', '/wallet', '/team/team_smashers', '/team/team_blockers', '/tournament/tour_monsoon',
  '/match/match_live', '/match/match_live_set3', '/match/match_old1', '/match/match_beach', '/match/match_finished',
  '/match/match_upcoming', '/match/match_flagged', '/match/match_live_set3/score', '/match/match_live/score', '/match/match_old1/score',
];
// [name, route, steps]: each step is a testID to click (first visible), or {text} / {wait}.
// 1.4.24: openers fixed (QA V1423-3) – photo sheet is `photo-button`, who-scored is `team-panel-A`, the DOB picker is
// on /edit-profile (`profile-dob`), and the lineup sheet needs a set start: match_upcoming (no rallies yet).
// {tabs: prefix} clicks every tab whose testID starts with the prefix and scans each one.
const ACTIONS = [
  ['score-menu', '/match/match_live_set3/score', ['score-menu']],
  ['abandon-dialog', '/match/match_live_set3/score', ['score-menu', 'menu-abandon']],
  ['sub-sheet', '/match/match_live_set3/score', ['court-sub']],
  ['photo-sheet', '/match/match_live_set3/score', ['photo-button']],
  ['who-scored', '/match/match_live_set3/score', ['team-panel-A']],
  ['lineup-sheet-pre-rally', '/match/match_upcoming/score', [{ optional: 'start-match' }, 'open-lineup']],
  ['help-faq-open', '/help?faq=score-how', []],
  ['ask-answer', '/ask', [{ fill: ['ask-input', 'How is a match scored?'] }, 'ask-send', { wait: 3000 }]],
  ['dob-picker', '/edit-profile', ['profile-dob']],
  ['want-to-play', '/match/match_upcoming', [{ optional: 'want-to-play' }, { wait: 800 }]],
  ['tournament-new-teams', '/tournament/new', [{ pressFirst: '[data-testid^="add-team-"]' }, { pressFirst: '[data-testid^="add-team-"]' }]],
  ['map-radius-25', '/(tabs)/map', [{ text: ['25 km', '25 कि.मी.', '25 किमी'] }]],
  ['match-tabs-live', '/match/match_live_set3', [{ tabs: 'match-tab-' }]],
  ['match-tabs-old1', '/match/match_old1', [{ tabs: 'match-tab-' }]],
  ['tournament-tabs', '/tournament/tour_monsoon', [{ tabs: 'tournament-tabs-' }]],
  ['new-match-steps', '/match/new', [{ tabs: 'step-tab-' }]],
];

function pageScan() {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const opac = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const st = document.createElement('style'); st.textContent = 'html body *, html body *::before { pointer-events: auto !important; }'; document.head.appendChild(st);
  const out = []; const unmeasured = [];
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    if (/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+$/u.test(own)) continue; // colour emoji: not painted in CSS colour
    const icon = /^[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}]+$/u.test(own); // icon-font glyph: non-text, 3:1
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
    const o = opac(el); if (o < 0.05) continue;
    // clipped by a scrolling/hidden-overflow ancestor (e.g. a picker row scrolled out of its column): not visible
    let clipped = false;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const ov = getComputedStyle(e); if (ov.overflow === 'visible' && ov.overflowY === 'visible' && ov.overflowX === 'visible') continue;
      const r2 = e.getBoundingClientRect(); const my = rect.top + rect.height / 2, mx = rect.left + Math.min(rect.width / 2, 12);
      if (my < r2.top || my > r2.bottom || mx < r2.left || mx > r2.right) { clipped = true; break; }
    }
    if (clipped) continue;
    const cx = Math.min(innerWidth - 1, Math.max(0, rect.left + Math.min(rect.width / 2, 12)));
    const cy = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const stack = document.elementsFromPoint(cx, cy);
    const idx = stack.indexOf(el);
    const anc = idx < 0 ? stack.findIndex((s) => el.contains(s) || s.contains(el)) : idx;
    if (anc < 0) continue; // covered by something else (behind a modal): not visible
    // Is the element covered by an opaque layer above it (a modal on top)?
    let covered = false;
    for (let i = 0; i < anc; i++) { const s = stack[i]; if (el.contains(s)) continue; const sc = parse(getComputedStyle(s).backgroundColor); if (sc && sc.a * opac(s) > 0.6) { covered = true; break; } }
    if (covered) continue;
    const layers = []; let image = false;
    for (let i = anc; i < stack.length; i++) {
      const s = stack[i]; const ss = getComputedStyle(s);
      if (s !== el && el.contains(s)) continue;
      if (ss.backgroundImage && ss.backgroundImage !== 'none') { image = true; break; }
      if (/^(IMG|CANVAS|VIDEO|svg|IFRAME)$/i.test(s.tagName) && s !== el) { image = true; break; }
      const c = parse(ss.backgroundColor); if (!c || c.a === 0) continue;
      const a = c.a * opac(s); layers.push({ ...c, a });
      if (a >= 0.999) break;
    }
    // 1.4.24: the element's own ancestors paint under it even when the hit-test stack leaves one out (seen with the
    // score toast pill): if the ancestor chain reaches an opaque fill first, that chain is the background.
    { const chain = []; let opaque = false; let chainEl = null;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const es = getComputedStyle(e); if (es.backgroundImage && es.backgroundImage !== 'none') break;
        const c = parse(es.backgroundColor); if (!c || c.a === 0) continue;
        chain.push({ ...c, a: c.a * Number(es.opacity) }); if (c.a >= 0.9) { opaque = true; chainEl = e; break; }
      }
      // only when the hit-test stack skipped that ancestor (otherwise the stack, which includes overlapping siblings, is right)
      if (opaque && !image && !stack.includes(chainEl)) { layers.length = 0; layers.push(...chain); } }
    const txt = parse(cs.color); if (!txt) continue;
    const id = (el.closest('[data-testid]') || {}).getAttribute?.('data-testid') || '';
    if (image) { unmeasured.push({ text: own.slice(0, 40), id }); continue; }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    const fg = over({ ...txt, a: txt.a * o }, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = icon || px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
    if (ratio + 0.005 < need) out.push({ text: own.slice(0, 50), id, ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, o: Math.round(o * 100) / 100, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, px });
  }
  st.remove();
  return { fails: out, unmeasured };
}

async function setup(browser, lang, theme) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 2400 }, locale: lang === 'hi' ? 'hi-IN' : 'en-IN', timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('volleylive.language', l); localStorage.setItem('volleylive.theme.v1', JSON.stringify({ setting: t, animate: false })); } catch {} }, [lang, theme]);
  const p = await ctx.newPage();
  return p;
}
async function login(p) {
  const tid = (id) => p.locator(`[data-testid="${id}"]`).locator('visible=true').first();
  await p.goto(BASE + '/login'); await tid('phone-input').waitFor({ timeout: 30000 });
  return tid;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const report = []; let failCount = 0; let checked = 0;
  for (const lang of LANGS) for (const theme of THEMES) {
    const p = await setup(b, lang, theme);
    const tid = (id) => p.locator(`[data-testid="${id}"]`).locator('visible=true').first();
    const scan = async (name) => {
      let r = await p.evaluate(pageScan); checked++;
      // settle: something mid-animation (a toast fading, a sheet sliding) is re-measured once after 900 ms
      if (r.fails.length) { await p.waitForTimeout(900); r = await p.evaluate(pageScan); }
      const key = `${theme}/${lang}/${name}`;
      if (r.fails.length) { failCount += r.fails.length; await p.screenshot({ path: `${OUT}/${theme}-${lang}-${name.replace(/[^a-z0-9]+/gi, '_')}.png` }); }
      report.push({ key, fails: r.fails, unmeasured: r.unmeasured.length });
      for (const f of r.fails) console.log('FAIL', key, JSON.stringify(f));
    };
    // signed-out screens first
    await p.goto(BASE + '/login'); await tid('phone-input').waitFor({ timeout: 30000 }); await p.waitForTimeout(1200);
    if (!ONLY || ONLY === '/login') { await scan('/login'); await tid('phone-input').fill('9000000010'); await p.waitForTimeout(300); await scan('/login+phone'); }
    else await tid('phone-input').fill('9000000010');
    await tid('send-otp').click(); await tid('otp-input').waitFor({ timeout: 15000 });
    if (!ONLY || ONLY === '/login') await scan('/login-otp');
    await tid('otp-input').fill('123456'); await tid('verify-otp').click(); await p.waitForTimeout(2500);
    if (await p.locator('[data-testid="terms-screen"]').count()) { await tid('terms-checkbox').click(); await tid('terms-accept').click(); await p.waitForTimeout(1500); }
    for (const r of ROUTES) {
      if (ONLY && ONLY !== r) continue;
      try { await p.goto(BASE + r); await p.waitForTimeout(2600); await scan(r); } catch (e) { console.log('SKIP', r, e.message.split('\n')[0]); }
    }
    for (const [name, route, steps] of ACTIONS) {
      if (ONLY && ONLY !== route && ONLY !== name) continue;
      try {
        await p.goto(BASE + route); await p.waitForTimeout(2600);
        let tabbed = false;
        for (const s of steps) {
          if (typeof s === 'string') { await tid(s).click({ timeout: 6000 }); await p.waitForTimeout(800); }
          else if (s.optional) { const l = p.locator(`[data-testid="${s.optional}"]`).locator('visible=true'); if (await l.count()) { await l.first().click(); await p.waitForTimeout(1200); } }
          else if (s.pressFirst) { await p.locator(s.pressFirst).locator('visible=true').first().click({ timeout: 6000 }); await p.waitForTimeout(800); }
          else if (s.text) { let done = false; for (const t of s.text) { const l = p.getByText(t, { exact: true }).locator('visible=true'); if (await l.count()) { await l.first().click(); done = true; break; } } if (!done) throw new Error('text not found: ' + s.text[0]); await p.waitForTimeout(800); }
          else if (s.fill) { await tid(s.fill[0]).fill(s.fill[1]); }
          else if (s.wait) await p.waitForTimeout(s.wait);
          else if (s.tabs) {
            const ids = await p.locator(`[data-testid^="${s.tabs}"]`).evaluateAll((els) => [...new Set(els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute('data-testid')))]);
            if (!ids.length) throw new Error('no tabs ' + s.tabs);
            for (const id of ids) { await p.locator(`[data-testid="${id}"]`).locator('visible=true').first().click({ timeout: 6000, force: true }); await p.waitForTimeout(1200); await scan(`action:${name}:${id}`); }
            tabbed = true;
          }
        }
        if (tabbed) continue;
        await scan('action:' + name);
      } catch (e) { console.log('SKIP action', name, e.message.split('\n')[0]); report.push({ key: `${theme}/${lang}/action:${name}`, skipped: true }); }
    }
    await p.context().close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  console.log(`SUMMARY checked=${checked} failures=${failCount} skipped=${report.filter((r) => r.skipped).length}`);
  // 1.4.24: an action that can't be opened is a failure too (it wasn't checked)
  const skipped = report.filter((r) => r.skipped).length;
  process.exit(failCount || skipped ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
