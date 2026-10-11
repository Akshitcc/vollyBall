/** Express app factory: all dependencies are injected (see src/index.ts and tests/helpers.ts). */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Services } from './context';
import { requireAuth } from './auth/middleware';
import { HttpError } from './errors';
import { ValidationError } from '../../src/core/validate';
import { apiRouter } from './routes/api';

export function createApp(s: Services) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // CORS for the web build (native apps don't need it)
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (origin && (s.corsOrigins.includes('*') || s.corsOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      await s.db.raw('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Photos: signed, expiring URLs (only handed out to signed-in users) so <Image> can load them without headers.
  app.get(/^\/files\/(.+)$/, async (req, res) => {
    const key = decodeURIComponent((req.params as unknown as string[])[0]);
    if (!s.storage.verify(key, req.query.exp as string | undefined, req.query.sig as string | undefined)) return res.status(403).json({ error: 'permission_denied', message: 'Link expired or invalid' });
    try {
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
    console.error('[api] unexpected error', e?.message ?? err);
    res.status(500).json({ error: 'internal', message: 'Something went wrong' });
  });
  return app;
}
