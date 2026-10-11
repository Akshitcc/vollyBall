/** HTTP errors thrown by route handlers and turned into JSON by the error middleware. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra fields for the JSON body (e.g. { field, min, max } for input errors). */
    readonly details?: Record<string, string | number | undefined>,
  ) {
    super(message);
  }
}
/** 400 for a shared input check (src/core/validate.ts); the app translates `code`. */
export const invalidInput = (code: string, message: string, details?: Record<string, string | number | undefined>) => new HttpError(400, code, message, details);
export const badRequest = (msg: string) => new HttpError(400, 'bad_request', msg);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthenticated', msg);
/** `rule` names the firestore.rules clause this check replaces (see server/RULES.md). */
export const forbidden = (rule: string, msg = 'Missing or insufficient permissions') => new HttpError(403, 'permission_denied', `${msg} [${rule}]`);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);
export const tooLarge = (msg: string) => new HttpError(413, 'too_large', msg);
