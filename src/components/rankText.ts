/**
 * 1.4.13 (QA V1412-6): the home rank card's "to pass" line. Ranks are always distinct (core/ranking.ts tie order), so
 * the player just above can have the same ranking points – then it says "tied", with 1 pt to pass, never "0 pts".
 */
import type { TFunction } from 'i18next';

export function toPassText(t: TFunction, mine: number, ahead: { rankingPoints: number; name?: string | null; rank: number | null }): string {
  const gap = ahead.rankingPoints - mine;
  return gap <= 0
    ? t('home.tiedPass', { name: ahead.name ?? '', n: ahead.rank })
    : t('home.toPass', { count: gap, name: ahead.name ?? '', n: ahead.rank });
}
