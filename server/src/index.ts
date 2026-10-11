/** Server entry point: wires real implementations and starts HTTP + WebSocket. */
import 'dotenv/config';
import http from 'node:http';
import { createApp } from './app';
import { DevTokenVerifier, FirebaseTokenVerifier } from './auth/verifier';
import { loadConfig } from './config';
import type { Services } from './context';
import { createDb } from './db/knex';
import { migrate } from './db/migrate';
import { uidForPhone } from './domain/users';
import { LiveBus } from './live/bus';
import { attachLive } from './live/ws';
import { ExpoPushSender, MemoryPushSender } from './push/pushSender';
import { LocalDiskStorage } from './storage/photoStorage';

async function main() {
  const cfg = loadConfig();
  const db = createDb(cfg.databaseUrl);
  if (process.env.MIGRATE_ON_START === '1') console.log('[db] applied', await migrate(db));
  const verifier = cfg.authMode === 'dev' ? new DevTokenVerifier((p) => uidForPhone(db, p)) : new FirebaseTokenVerifier(cfg.firebaseProjectId);
  if (cfg.authMode === 'dev') console.warn('[auth] AUTH_MODE=dev – accepts unsigned dev tokens. Local testing only!');
  const services: Services = {
    db,
    verifier,
    storage: new LocalDiskStorage(cfg.storageDir, cfg.publicBaseUrl, cfg.fileUrlSecret, cfg.fileUrlTtlSeconds),
    push: cfg.pushEnabled ? new ExpoPushSender(cfg.expoAccessToken) : new MemoryPushSender(),
    bus: new LiveBus(),
    publicBaseUrl: cfg.publicBaseUrl,
    corsOrigins: cfg.corsOrigins,
    adminUids: new Set(cfg.adminUids),
  };
  if (cfg.adminUids.length) console.log(`[admin] ${cfg.adminUids.length} admin uid(s) from ADMIN_UIDS`);
  const server = http.createServer(createApp(services));
  const live = attachLive(server, services.bus, verifier);
  server.listen(cfg.port, () => console.log(`[api] VolleyLive API on :${cfg.port} (auth=${cfg.authMode})`));
  const stop = () => {
    live.close();
    server.close(() => db.destroy().then(() => process.exit(0)));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
