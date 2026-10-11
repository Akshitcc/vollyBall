/**
 * Launch prep: structured JSON logs (one object per line) with a request id, and NO personal data or
 * secrets. Anything that might carry one goes through `redact` first: phone numbers, e-mail addresses,
 * bearer/session tokens, URL signatures and query strings, OTP codes and long digit runs.
 * Log levels: error < warn < info < debug (LOG_LEVEL, default info; `silent` in tests).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'silent';
const ORDER: Record<LogLevel, number> = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };
type Fields = Record<string, string | number | boolean | null | undefined>;

/** Removes things that must never reach a log line. Safe to call on any string. */
export function redact(input: unknown): string {
  let s = String(input ?? '');
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+/=:-]+/gi, 'Bearer [redacted]');
  s = s.replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/g, '[token]'); // JWTs
  s = s.replace(/\bvls1\.[A-Za-z0-9_.-]+/g, '[token]'); // our session tokens
  s = s.replace(/\bdev:\+?\d+/g, 'dev:[phone]');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  s = s.replace(/\+?\d[\d\s-]{8,}\d/g, '[number]'); // phone numbers and other long digit runs
  s = s.replace(/\b(otp|code|password|secret|authkey|token|sig|signature|key)=([^&\s"']+)/gi, '$1=[redacted]');
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/** Path for logs: no query string, ids kept, anything number-like or token-like redacted. */
export function logPath(url: string): string {
  return redact(url.split('?')[0]).slice(0, 200);
}

/** Values we generate or validate ourselves (request ids are [A-Za-z0-9_-] only). */
const SAFE_FIELDS = new Set(['reqId', 'method', 'version']);

export class Logger {
  constructor(
    private readonly level: LogLevel = 'info',
    private readonly out: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
    private readonly base: Fields = {},
  ) {}
  child(fields: Fields) {
    return new Logger(this.level, this.out, { ...this.base, ...fields });
  }
  private write(level: Exclude<LogLevel, 'silent'>, msg: string, fields: Fields = {}) {
    if (ORDER[level] > ORDER[this.level]) return;
    const clean: Fields = {};
    for (const [k, v] of Object.entries({ ...this.base, ...fields })) clean[k] = typeof v === 'string' && !SAFE_FIELDS.has(k) ? redact(v) : v;
    this.out(JSON.stringify({ t: new Date().toISOString(), level, msg: redact(msg), ...clean }));
  }
  error(msg: string, f?: Fields) {
    this.write('error', msg, f);
  }
  warn(msg: string, f?: Fields) {
    this.write('warn', msg, f);
  }
  info(msg: string, f?: Fields) {
    this.write('info', msg, f);
  }
  debug(msg: string, f?: Fields) {
    this.write('debug', msg, f);
  }
}

export function parseLogLevel(v: string | undefined): LogLevel {
  const l = (v || 'info').toLowerCase();
  return (Object.keys(ORDER) as LogLevel[]).includes(l as LogLevel) ? (l as LogLevel) : 'info';
}

/** Process-wide logger (index.ts replaces it from LOG_LEVEL; tests set `silent`). */
export let log = new Logger(parseLogLevel(process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info')));
export function setLogger(l: Logger) {
  log = l;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}

const REQ_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Gives every request an id (a valid incoming X-Request-Id from the proxy, else a new one), returns it in
 * the X-Request-Id header and writes one `request` line when the response is finished. No body, no
 * query string, no user id, no IP.
 */
export function requestLogger(getLog: () => Logger = () => log) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const id = incoming && REQ_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : 'info';
      getLog()[level]('request', { reqId: id, method: req.method, path: logPath(req.originalUrl || req.url), status: res.statusCode, ms: Math.round(ms) });
    });
    next();
  };
}
