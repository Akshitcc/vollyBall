/** Express app factory: all dependencies are injected (see src/index.ts and tests/helpers.ts). */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Services } from './context';
import { requireAuth } from './auth/middleware';
import crypto from 'node:crypto';
import { RateLimiter } from './rateLimit';
import { listDailyItems } from './domain/feedback';
import { HttpError } from './errors';
import { ValidationError } from '../../src/core/validate';
import { apiRouter, DAILY_PUBLIC_RATE } from './routes/api';
import { authRouter } from './routes/auth';
import { log, redact, requestLogger } from './ops/logger';

export function createApp(s: Services) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', s.trustProxy ?? 'loopback');
  app.use(requestLogger());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // CORS for the web build (native apps don't need it)
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && (s.corsOrigins.includes('*') || s.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Access-Control-Expose-Headers', 'Date'); // 1.3.8: the web app reads the server clock (review cooldown)
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Launch prep: /health = readiness (database ping, 2 s budget) for the platform health check;
  // /healthz = liveness (the process answers). Neither needs a token or reveals config values.
  app.get('/health', async (_req, res) => {
    const t0 = Date.now();
    try {
      await Promise.race([s.db.raw('SELECT 1'), new Promise((_r, rej) => setTimeout(() => rej(new Error('db timeout')), 2000))]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ok: true, db: 'ok', dbMs: Date.now() - t0, uptimeS: Math.round(process.uptime()), ...(s.info ?? {}) });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Photos: signed, expiring URLs (only handed out to signed-in users) so <Image> can load them without headers.
  app.get(/^\/files\/(.+)$/, async (req, res) => {
    const key = decodeURIComponent((req.params as unknown as string[])[0]);
    if (!s.storage.verify(key, req.query.exp as string | undefined, req.query.sig as string | undefined)) return res.status(403).json({ error: 'permission_denied', message: 'Link expired or invalid' });
    try {
      const to = s.storage.redirectUrl?.(key);
      if (to) {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.redirect(302, to);
      }
      const f = await s.storage.get(key);
      if (!f) return res.status(404).json({ error: 'not_found', message: 'File not found' });
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(f.data);
    } catch {
      res.status(400).json({ error: 'bad_request', message: 'Invalid file path' });
    }
  });

  if (s.auth) app.use('/auth', authRouter(s.auth.otp, s.db, s.auth.signer));
  // 1.3.7: "Fact of the day" items are public (read only, active items, per-IP rate limit); everything
  // else under /api needs a signed-in user. Admin writes live in apiRouter (/api/admin/daily-items).
  app.get('/api/daily-items', async (req, res, next) => {
    try {
      const limiter = (s.rateLimiter ??= new RateLimiter());
      const ipKey = crypto.createHash('sha256').update(String(req.ip ?? '')).digest('hex').slice(0, 32);
      const wait = await limiter.takeShared(ipKey, 'dailyPublic', DAILY_PUBLIC_RATE);
      if (wait) {
        res.setHeader('Retry-After', String(wait));
        return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Wait a moment and try again.', retryAfter: wait });
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(await listDailyItems(s, null));
    } catch (e) {
      next(e);
    }
  });
  app.use('/api', express.json({ limit: '1mb' }), requireAuth(s.verifier), apiRouter(s));

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'No such route' }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ ...(err.details ?? {}), error: err.code, message: err.message });
    if (err instanceof ValidationError)
      return res.status(400).json({ error: err.code, message: `Invalid request: ${err.message}`, field: err.field, min: err.min, max: err.max });
    const e = err as { type?: string; status?: number; code?: string; errno?: number; message?: string };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Request too large' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request', message: 'Invalid JSON' });
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'conflict', message: 'Already exists' });
    if (e?.code === 'ER_NO_REFERENCED_ROW_2' || e?.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return res.status(400).json({ error: 'bad_request', message: 'Invalid reference or value' });
    log.error('unexpected error', { reqId: _req.requestId, code: e?.code, err: redact(e?.message ?? err) });
    res.status(500).json({ error: 'internal', message: 'Something went wrong' });
  });
  return app;
}
