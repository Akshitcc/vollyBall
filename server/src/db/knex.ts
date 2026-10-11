/** Knex (mysql2) connection. Dates are stored and read as UTC. */
import fs from 'node:fs';
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

/** TLS options for mysql2 (managed MySQL: PlanetScale, Aiven, DigitalOcean, RDS, Railway…). */
export interface DbSsl {
  /** PEM CA certificate(s); omit to use Node's public CA list. */
  ca?: string;
  rejectUnauthorized: boolean;
}

/**
 * Launch prep: TLS to a managed database, from env (no values in code):
 *   DB_SSL=1                      require TLS (also turned on by ?ssl=true / ?sslmode=require|verify-full in DATABASE_URL)
 *   DB_SSL_CA="-----BEGIN…"       the provider's CA certificate as text (newlines may be written as \n), or
 *   DB_SSL_CA_FILE=/path/ca.pem   the same as a file
 *   DB_SSL_REJECT_UNAUTHORIZED=0  only for a provider without a verifiable certificate (not recommended)
 */
export function sslFromEnv(env: NodeJS.ProcessEnv, url?: string): DbSsl | undefined {
  let fromUrl = false;
  if (url) {
    const q = new URL(url).searchParams;
    const mode = (q.get('sslmode') || q.get('ssl-mode') || '').toLowerCase();
    fromUrl = q.get('ssl') === 'true' || q.get('ssl') === '1' || ['require', 'required', 'verify-ca', 'verify-full', 'verify_identity'].includes(mode);
  }
  const on = env.DB_SSL === '1' || env.DB_SSL === 'true' || fromUrl || !!env.DB_SSL_CA || !!env.DB_SSL_CA_FILE;
  if (!on) return undefined;
  let ca: string | undefined;
  if (env.DB_SSL_CA) ca = env.DB_SSL_CA.replace(/\\n/g, '\n');
  else if (env.DB_SSL_CA_FILE) ca = fs.readFileSync(env.DB_SSL_CA_FILE, 'utf8');
  if (ca && !ca.includes('BEGIN CERTIFICATE')) throw new Error('DB_SSL_CA / DB_SSL_CA_FILE must be a PEM certificate');
  return { ...(ca ? { ca } : {}), rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== '0' };
}

export function createDb(url: string, pool: { min?: number; max?: number } = {}, ssl?: DbSsl): Db {
  return knexFactory({
    client: 'mysql2',
    connection: { ...connectionFromUrl(url), ...(ssl ? { ssl } : {}) },
    pool: { min: pool.min ?? 0, max: pool.max ?? 10 },
  });
}
