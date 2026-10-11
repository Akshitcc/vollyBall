import 'dotenv/config';
import { createDb } from './knex';
import { dropAll, migrate } from './migrate';

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = createDb(process.env.DATABASE_URL);
  try {
    if (process.argv.includes('--reset')) {
      if (process.env.NODE_ENV === 'production') throw new Error('--reset is refused in production');
      await dropAll(db);
      console.log('dropped all tables');
    }
    const applied = await migrate(db);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema up to date');
  } finally {
    await db.destroy();
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
