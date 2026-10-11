/**
 * Leaving a screen safely. `router.back()` throws "The action 'GO_BACK' was not handled" when the
 * screen was opened directly (fresh tab, deep link, notification, reload), so every screen that
 * goes back uses this helper: back when there is history, otherwise replace with a sensible screen.
 */
import { router, type Href } from 'expo-router';

export function goBackOr(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * Where the header back arrow goes when a screen was opened directly (fresh tab, shared link,
 * notification) and there is nothing to go back to: the tab the screen naturally belongs to.
 */
export function backFallback(routeName: string, params?: Record<string, unknown> | object): Href {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (routeName) {
    case 'challenge/new':
      return typeof p.fromTeamId === 'string' && p.fromTeamId ? (`/team/${p.fromTeamId}` as Href) : '/';
    case 'team/[id]':
    case 'team/new':
    case 'edit-profile':
      return '/profile';
    case 'teams':
    case 'memories':
      return '/';
    case 'tournament/[id]':
    case 'tournament/new':
      return '/tournaments';
    case 'court/new':
    case 'court/[id]':
      return '/map';
    default:
      return '/';
  }
}

/** Screens that never show a back arrow (tab roots, sign-in, first-time profile). */
export const NO_BACK_ROUTES = new Set(['(tabs)', 'login', 'terms', 'setup-profile']);

/**
 * Params a deep link leaked onto the (tabs) route underneath it (expo-router copies the linked
 * screen's params onto its initialRouteName), as a patch that clears them; null when clean.
 * The tabs take no params of their own; navigator keys (screen/params/initial/state) are kept.
 */
export function leakedTabParams(params: object | undefined): Record<string, undefined> | null {
  const p = (params ?? {}) as Record<string, unknown>;
  const keys = Object.keys(p).filter((k) => p[k] !== undefined && k !== 'screen' && k !== 'params' && k !== 'initial' && k !== 'state');
  return keys.length ? Object.fromEntries(keys.map((k) => [k, undefined])) : null;
}
