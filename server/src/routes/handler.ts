import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const csv = (v: unknown, max = 100): string[] =>
  typeof v === 'string' && v
    ? [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, max)
    : [];
