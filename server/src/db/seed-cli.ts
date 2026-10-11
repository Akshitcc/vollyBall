/** npm run seed – loads the demo data. Refused in production. */
import 'dotenv/config';
import { StaticTokenVerifier } from '../auth/verifier';
import type { Services } from '../context';
import { LiveBus } from '../live/bus';
import { MemoryPushSender } from '../push/pushSender';
import { LocalDiskStorage } from '../storage/photoStorage';
import { loadConfig } from '../config';
import { createDb } from './knex';
import { migrate } from './migrate';
import { seedDemo } from './seed';

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Seeding demo data is refused in production');
  const cfg = loadConfig({ ...process.env, AUTH_MODE: 'dev' });
  const db = createDb(cfg.databaseUrl);
  try {
    await migrate(db);
    if (await db('users').first('id')) {
      console.log('database already has users – skipping seed (run `npm run migrate -- --reset` first to start over)');
      return;
    }
    const s: Services = {
      db,
      verifier: new StaticTokenVerifier({}),
      storage: new LocalDiskStorage(cfg.storageDir, cfg.publicBaseUrl, cfg.fileUrlSecret, cfg.fileUrlTtlSeconds),
      push: new MemoryPushSender(), // seeding never sends real pushes
      bus: new LiveBus(),
      publicBaseUrl: cfg.publicBaseUrl,
      corsOrigins: [],
    };
    console.log('seeded', await seedDemo(s));
  } finally {
    await db.destroy();
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
