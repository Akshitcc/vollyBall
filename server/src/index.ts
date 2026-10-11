/** Server entry point: wires real implementations and starts HTTP + WebSocket. */
import { PincodeLookup } from './pincode';
import 'dotenv/config';
import http from 'node:http';
import { createApp } from './app';
import { DevTokenVerifier, FirebaseTokenVerifier, type TokenVerifier } from './auth/verifier';
import { DevOtpProvider, FirebasePhoneProvider, Msg91Provider, type OtpProvider } from './auth/otp/providers';
import { OtpService } from './auth/otp/otpService';
import { CompositeVerifier, SessionSigner, SessionTokenVerifier } from './auth/otp/sessions';
import { loadConfig, type Config } from './config';
import type { Services } from './context';
import { createDb, sslFromEnv } from './db/knex';
import { migrateLocked } from './db/migrate';
import { uidForPhone } from './domain/users';
import { LiveBus } from './live/bus';
import { attachLive } from './live/ws';
import { Logger, log, setLogger } from './ops/logger';
import { RedisClient } from './ops/redis';
import { ExpoPushSender, MemoryPushSender } from './push/pushSender';
import { RateLimiter } from './rateLimit';
import { RedisRateStore } from './rateStore';
import { FileLinkSigner, LocalDiskStorage, type PhotoStorage } from './storage/photoStorage';
import { S3Storage } from './storage/s3Storage';

const VERSION = process.env.APP_VERSION || process.env.npm_package_version || '1.0.0';

/** Local disk or S3/R2-compatible object storage (STORAGE_DRIVER). */
export function createStorage(cfg: Config): PhotoStorage {
  if (cfg.storage.driver === 's3') return new S3Storage(cfg.storage.s3, new FileLinkSigner(cfg.publicBaseUrl, cfg.fileUrlSecret, cfg.fileUrlTtlSeconds));
  return new LocalDiskStorage(cfg.storageDir, cfg.publicBaseUrl, cfg.fileUrlSecret, cfg.fileUrlTtlSeconds);
}

async function main() {
  const cfg = loadConfig();
  setLogger(new Logger(cfg.logLevel, undefined, { svc: 'volleylive-api' }));
  const db = createDb(cfg.databaseUrl, {}, sslFromEnv(process.env, cfg.databaseUrl));
  if (process.env.MIGRATE_ON_START === '1') log.info('migrations', { applied: (await migrateLocked(db)).join(',') || 'none' });

  const redis = cfg.redisUrl ? new RedisClient(cfg.redisUrl) : null;
  const rateLimiter = new RateLimiter(undefined, undefined, redis ? new RedisRateStore(redis) : undefined);
  if (!redis) log.info('rate limits in memory (single instance); set REDIS_URL to share them across instances');

  let verifier: TokenVerifier;
  let auth: Services['auth'];
  if (cfg.authMode === 'dev') {
    verifier = new DevTokenVerifier((p) => uidForPhone(db, p));
    log.warn('AUTH_MODE=dev accepts unsigned dev tokens. Local testing only!');
  } else if (cfg.authMode === 'otp' && cfg.otp) {
    const signer = new SessionSigner(cfg.otp.sessionSecret, cfg.otp.sessionTtlSeconds);
    const firebase = cfg.otp.provider === 'firebase' ? new FirebaseTokenVerifier(cfg.firebaseProjectId) : null;
    const provider: OtpProvider =
      cfg.otp.provider === 'msg91' ? new Msg91Provider(cfg.otp.msg91!) : cfg.otp.provider === 'firebase' ? new FirebasePhoneProvider(firebase!) : new DevOtpProvider();
    if (cfg.otp.provider === 'dev') log.warn('OTP_PROVIDER=dev: no SMS is sent and the code is always 123456. Local testing only!');
    const sessions = new SessionTokenVerifier(db, signer);
    // Firebase Phone Auth: the app may keep sending Firebase ID tokens directly, or exchange them at /auth/firebase.
    verifier = firebase ? new CompositeVerifier([sessions, firebase]) : sessions;
    auth = { otp: new OtpService(db, provider, signer, cfg.otp.sessionSecret, rateLimiter, cfg.otp.limits), signer };
  } else {
    verifier = new FirebaseTokenVerifier(cfg.firebaseProjectId);
  }

  const storage = createStorage(cfg);
  const services: Services = {
    pincode: new PincodeLookup(process.env.PINCODE_LOOKUP !== '0'),
    minAge: Number(process.env.MIN_AGE) >= 1 ? Math.floor(Number(process.env.MIN_AGE)) : undefined,
    db,
    verifier,
    storage,
    push: cfg.pushEnabled ? new ExpoPushSender(cfg.expoAccessToken) : new MemoryPushSender(),
    bus: new LiveBus(),
    publicBaseUrl: cfg.publicBaseUrl,
    corsOrigins: cfg.corsOrigins,
    adminUids: new Set(cfg.adminUids),
    rateLimiter,
    auth,
    trustProxy: cfg.trustProxy,
    info: { version: VERSION, storage: storage.kind ?? 'local', rateStore: redis ? 'redis' : 'memory', auth: cfg.authMode === 'otp' ? `otp:${cfg.otp?.provider}` : cfg.authMode },
  };
  if (cfg.adminUids.length) log.info('admins from ADMIN_UIDS', { count: cfg.adminUids.length });
  const server = http.createServer(createApp(services));
  const live = attachLive(server, services.bus, verifier);
  server.listen(cfg.port, () => log.info('listening', { port: cfg.port, auth: services.info!.auth, storage: services.info!.storage, rateStore: services.info!.rateStore, version: VERSION }));
  const stop = () => {
    log.info('shutting down');
    live.close();
    server.close(() => Promise.all([db.destroy(), redis?.close()]).then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module)
  main().catch((e) => {
    log.error('startup failed', { err: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  });
