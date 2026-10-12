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
 * 1.4.1 (QA V140-14): after "Save" on Edit profile the user lands on Profile – whatever opened the form (the
 * Profile header Edit, Home's "update your phone" link, a fresh web load). dismissTo pops back to the Profile
 * tab when it is in the stack, else replaces the form with it.
 */
export function toProfileAfterSave() {
  try {
    router.dismissTo('/profile');
  } catch {
    router.replace('/profile');
  }
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
    // 1.4.0 (QA V139-9): the admin screens are opened from Profile
    case 'admin-review':
    case 'admin-daily':
    case 'admin-feedback':
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

type NavState = { index: number; routes: { name: string; state?: { index?: number; routes: { name: string }[] } }[] };
/** 1.4.0 (QA V139-9): screens that belong to a tab – back always lands there. */
export const HOME_TAB: Readonly<Record<string, string>> = Object.freeze({ 'admin-review': 'profile', 'admin-daily': 'profile', 'admin-feedback': 'profile' });
/**
 * The header back arrow. On the web a direct load (fresh tab, reload, shared link) puts the tabs' first tab
 * (Home) under the screen, so canGoBack() is true and "back" went Home; a screen in HOME_TAB goes to its tab
 * instead unless what is underneath really is that tab (or another screen, e.g. admin-review under
 * admin-feedback). `state` = the stack's navigation state at press time.
 */
export function headerBack(routeName: string, params?: object, state?: NavState): void {
  const tab = HOME_TAB[routeName];
  if (tab && state) {
    const prev = state.routes[state.index - 1];
    const underTab = prev?.name === '(tabs)' ? prev.state?.routes[prev.state.index ?? 0]?.name : undefined;
    if (!prev || (prev.name === '(tabs)' && underTab !== tab)) {
      router.navigate(`/${tab}` as Href);
      return;
    }
  }
  goBackOr(backFallback(routeName, params));
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

/**
 * 1.3.5 (QA E134-1): tab buttons on the web are real links (<a href="/score">). React Navigation's
 * own button calls preventDefault() before navigating; our custom tab button (press-scale feedback)
 * did not, so every tab press ALSO let the browser follow the link: a full page reload that threw
 * away all in-memory state (the demo "Simulate offline" switch, the offline/pending header, the
 * upload queue). This wraps onPress the same way: plain left clicks stay inside the app; clicks with
 * a modifier key / middle click / target=_blank are left to the browser (open in a new tab).
 */
type WebPressEvent = {
  preventDefault?: () => void;
  metaKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  button?: number | null;
  currentTarget?: unknown;
};
export function inAppLinkPress<E>(onPress: ((e: E) => void) | undefined, opts: { web: boolean; href?: string | null }) {
  return (e: E) => {
    if (!opts.web || opts.href == null) return onPress?.(e);
    const w = e as unknown as WebPressEvent;
    const modifier = !!(w.metaKey || w.altKey || w.ctrlKey || w.shiftKey);
    const left = w.button == null || w.button === 0;
    const target = (w.currentTarget as { target?: string } | null | undefined)?.target;
    const self = target === undefined || target === null || target === '' || target === 'self' || target === '_self';
    if (modifier || !left || !self) return; // the browser opens it (new tab etc.)
    w.preventDefault?.();
    onPress?.(e);
  };
}
