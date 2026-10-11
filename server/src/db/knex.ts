/** Knex (mysql2) connection. Dates are stored and read as UTC. */
import knexFactory, { type Knex } from 'knex';

export type Db = Knex;

/**
 * Accepts mysql://user:password@host:port/database. A `?socket=/path/mysql.sock`
 * query parameter connects through a Unix socket instead of TCP.
 */
export function connectionFromUrl(url: string): Knex.MySql2ConnectionConfig {
  const u = new URL(url);
  if (u.protocol !== 'mysql:') throw new Error('DATABASE_URL must start with mysql://');
  const socketPath = u.searchParams.get('socket') || undefined;
  return {
    host: socketPath ? undefined : u.hostname,
    port: socketPath ? undefined : Number(u.port || 3306),
    socketPath,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    timezone: 'Z',
    dateStrings: false,
    decimalNumbers: true,
    supportBigNumbers: true,
    charset: 'utf8mb4',
  };
}

export function createDb(url: string, pool: { min?: number; max?: number } = {}): Db {
  return knexFactory({
    client: 'mysql2',
    connection: connectionFromUrl(url),
    pool: { min: pool.min ?? 0, max: pool.max ?? 10 },
  });
}
