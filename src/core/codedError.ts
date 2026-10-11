/** An Error with a stable `code` the UI translates (src/i18n/format.ts translateCode), like ApiError. */
export class CodedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CodedError';
  }
}

export const PHOTO_NOT_ALLOWED = 'photo_not_allowed';
export const PHOTO_NOT_ALLOWED_MESSAGE = 'Only the players and the scorer of this match can add photos';
