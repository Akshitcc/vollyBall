/** Launch prep: production stand-in for services/backend/demoSeed.ts (see metro.config.js). No seed data. */
export const DEMO_QA_ADMIN = { id: '', phone: '', name: '' } as const;
export const SEED_PHOTO_SCENES: Record<string, number> = {};
export function makeSeed(): never {
  throw new Error('Demo seed data is not part of production builds.');
}
export function demoPhotoUrl(): string {
  return '';
}
