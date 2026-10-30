/**
 * 1.4.26 DB integrity audit CLI.
 *   npx tsx scripts/db-audit.ts --sql                 print db-audit.sql (generated from src/ops/dbAudit.ts)
 *   DATABASE_URL=… npx tsx scripts/db-audit.ts        run the read-only checks (SELECT only) and print PASS/FAIL
 *   DATABASE_URL=…/volleylive_audit npx tsx scripts/db-audit.ts --simulate
 *       fresh scratch database: drop + migrate, simulate through the API, then run the checks.
 *       Refused unless the database is on localhost:3306 and its name ends in _audit or _test.
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { StaticTokenVerifier, type Identity } from '../src/auth/verifier';
import { createDb } from '../src/db/knex';
import { dropAll, migrate } from '../src/db/migrate';
import { LiveBus } from '../src/live/bus';
import { MemoryPushSender } from '../src/push/pushSender';
import { LocalDiskStorage } from '../src/storage/photoStorage';
import { Logger, setLogger } from '../src/ops/logger';
import { auditSql, runAudit } from '../src/ops/dbAudit';
import { RateLimiter } from '../src/rateLimit';
import { simulate, type ClientFor } from './auditSim';
import { simulateGroups } from './groupsSim';

async function main() {
  if (process.argv.includes('--sql')) return void process.stdout.write(auditSql());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url, { max: 5 });
  try {
    if (process.argv.includes('--simulate')) {
      const u = new URL(url);
      const name = u.pathname.replace(/^\//, '');
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) || (u.port || '3306') !== '3306' || !/_(audit|test)$/.test(name))
        throw new Error('--simulate drops every table: only a local scratch database (localhost:3306, name ending in _audit or _test)');
      setLogger(new Logger('silent'));
      await dropAll(db);
      await migrate(db);
      const tokens: Record<string, Identity> = {};
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-audit-'));
      const big = { burst: 1e6, perMinute: 1e6 };
      const s = { db, verifier: new StaticTokenVerifier(tokens), storage: new LocalDiskStorage(dir, 'http://audit.local', 'audit-secret-'.repeat(4), 3600), push: new MemoryPushSender(), bus: new LiveBus(), publicBaseUrl: 'http://audit.local', corsOrigins: [], pending: new Set<Promise<unknown>>(), adminUids: new Set<string>(), rateLimiter: Object.assign(new RateLimiter({ terms: big, verify: big, matchWrite: big }), { liftNamed: true }) };
      const server = http.createServer(createApp(s as never));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const client: ClientFor = (uid, phone) => async (method, p, body, headers = {}) => {
        tokens[`t-${uid}`] = { uid, phone };
        const r = await fetch(base + p, { method, headers: { Authorization: `Bearer t-${uid}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
        const text = await r.text();
        return { status: r.status, body: text ? JSON.parse(text) : null };
      };
      const t0 = Date.now();
      const rep = await simulate(client);
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`simulated in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${rep.users.length} users, ${rep.teams.length} teams, friendly ${rep.friendly.matchId} (${rep.friendly.rallies} rallies), knockout ${rep.tournament.played} matches + ${rep.tournament.byes} byes, league ${rep.league.played} matches; 33-team tournament → HTTP ${rep.oversizeStatus}`);
      // 1.4.27 (E2E-4): 15 teams groups + knockout, 17 teams groups and 17 teams play-in
      for (const [n, mode, prefix, base] of [[15, 'groups', 'g15', 9300000000], [17, 'groups', 'g17', 9310000000], [17, 'playin', 'p17', 9320000000]] as const) {
        const g = await simulateGroups(client, { teams: n, mode, prefix, phoneBase: base });
        console.log(`${n} teams ${mode}: planned ${g.planned}, played ${g.played} (group ${g.groupMatches}, knockout ${g.knockoutMatches}), groups ${g.tables.map((x) => x.order.length).join('/') || '-'}, qualifiers ${g.qualifiersOk ? 'ok' : 'WRONG'}, champion ${g.names[g.champion ?? ''] ?? g.champion}; refused: early slot ${g.refused.earlySlot || '-'} ${g.refused.earlyCode ?? ''}, played-fixture edit ${g.refused.lockedEdit} ${g.refused.lockedCode}, non-owner ${g.refused.nonOwner}`);
        if (g.played !== g.planned || !g.champion || !g.qualifiersOk) throw new Error(`${n} ${mode}: run incomplete`);
      }
      server.close();
    }
    const res = await runAudit(db);
    for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.area.padEnd(9)} ${r.id.padEnd(34)} ${r.ok ? '' : `${r.violations} row(s) e.g. ${JSON.stringify(r.sample).slice(0, 300)}`}`);
    const counts = (await db.raw("SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM teams) teams, (SELECT COUNT(*) FROM team_members) team_members, (SELECT COUNT(*) FROM matches) matches, (SELECT COUNT(*) FROM sets) sets, (SELECT COUNT(*) FROM points) points, (SELECT COUNT(*) FROM timeouts) timeouts, (SELECT COUNT(*) FROM tournaments) tournaments, (SELECT COUNT(*) FROM fixtures) fixtures, (SELECT COUNT(*) FROM player_finished_matches) player_match_rows"))[0][0];
    console.log('counts', JSON.stringify(counts));
    const bad = res.filter((r) => !r.ok).length;
    console.log(`SUMMARY checks=${res.length} pass=${res.length - bad} fail=${bad}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await db.destroy();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
