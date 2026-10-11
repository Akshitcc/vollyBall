/**
 * 1.3.7 in-app review (expo-store-review) and the "Rate VolleyLive" link.
 *
 * NOT LIVE UNTIL THE APP IS PUBLISHED: Google Play only shows its review sheet (and the listing only
 * exists) once com.volleylive.app is on the Play Store. Until then requestReview() silently does nothing
 * and the market:// / https links open a "not found" page. Demo builds show a clearly labelled mock.
 *
 * When to ask is decided by core/reviewPrompt.ts (happy moment, >= 3 completed matches, once per 60
 * days per user, never during live scoring). Reviews are never rewarded.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Linking } from 'react-native';
import i18n from '../i18n';
import { PLAY_MARKET_URL, PLAY_WEB_URL, reviewEligible, type ReviewMoment } from '../core/reviewPrompt';
import { openDialog } from '../state/dialog';
import { DEMO_MODE } from './config';

/**
 * REVIEW_PREPROMPT – keep this FALSE.
 *
 * POLICY RISK: Google Play's review policy forbids "review gating": asking users whether they like the
 * app first ("Enjoying VolleyLive? Yes / Not really") and only sending happy users to the review sheet
 * (and unhappy ones to feedback). Doing so can get the app's listing / ratings penalised or removed.
 * The default flow therefore calls StoreReview.requestReview() directly at the happy moment. The
 * pre-prompt exists only because it was asked to be built behind a flag; do not turn it on for a
 * Play Store build without a policy review. Overridable for tests / experiments via
 * EXPO_PUBLIC_REVIEW_PREPROMPT=1.
 */
export const REVIEW_PREPROMPT: boolean = process.env.EXPO_PUBLIC_REVIEW_PREPROMPT === '1';

const KEY = (uid: string) => `volleylive.review.lastAsked.${uid}`;

export async function lastAskedAt(uid: string): Promise<number | null> {
  try {
    const v = await AsyncStorage.getItem(KEY(uid));
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The labelled demo stand-in for Google Play's sheet (no network, nothing is submitted). */
export function showDemoReviewSheet(): Promise<boolean> {
  return openDialog({ title: i18n.t('review.demoTitle'), message: i18n.t('review.demoText'), buttons: [{ text: i18n.t('common.ok'), value: true }] });
}

/** Shows the native review sheet (or the demo mock). Returns false if nothing could be shown. */
export async function showReviewSheet(opts: { demo?: boolean } = {}): Promise<boolean> {
  if (opts.demo ?? DEMO_MODE) {
    await showDemoReviewSheet();
    return true;
  }
  try {
    if (!(await StoreReview.isAvailableAsync())) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  }
}

/**
 * Called at a happy moment (won match finished / confirmed, POTM). Asks only when eligible, records
 * the time per user before asking (so a crash can't cause repeat prompts). Returns whether it asked.
 */
export async function maybeAskForReview(p: {
  uid: string;
  moment: ReviewMoment | null;
  completedMatches: number;
  liveScoring?: boolean;
  now?: number;
  preprompt?: boolean;
  demo?: boolean;
  /**
   * 1.3.9 (V137-4): a server-kept clock (Firebase). When given, "now" and the last-asked time are both
   * server timestamps and the phone clock is not used; if it fails, nothing is asked this time.
   * Without it: API → p.now from the server's Date header; demo → the phone clock (documented: a demo
   * has no server, so changing the phone's date can re-show the mock sheet – harmless, nothing is sent).
   */
  serverClock?: { read: () => Promise<{ now: number; lastAskedAt: number | null }>; mark: () => Promise<void> };
}): Promise<boolean> {
  if (p.serverClock) {
    let c: { now: number; lastAskedAt: number | null };
    try {
      c = await p.serverClock.read();
    } catch {
      return false;
    }
    if (!reviewEligible({ completedMatches: p.completedMatches, lastAskedAt: c.lastAskedAt, now: c.now, liveScoring: !!p.liveScoring, moment: p.moment })) return false;
    try {
      await p.serverClock.mark();
    } catch {
      return false; // not recorded = don't ask (no repeat prompts)
    }
  } else {
    const now = p.now ?? Date.now();
    const ok = reviewEligible({ completedMatches: p.completedMatches, lastAskedAt: await lastAskedAt(p.uid), now, liveScoring: !!p.liveScoring, moment: p.moment });
    if (!ok) return false;
    try {
      await AsyncStorage.setItem(KEY(p.uid), String(now));
    } catch {
      // storage failure: still at most once per session (the caller keeps its own guard)
    }
  }
  if (p.preprompt ?? REVIEW_PREPROMPT) {
    // Policy risk – see REVIEW_PREPROMPT. "Not really" never leads to the store.
    const yes = await openDialog({
      title: i18n.t('review.prepromptTitle'),
      message: '',
      buttons: [
        { text: i18n.t('review.prepromptNo'), style: 'cancel', value: false },
        { text: i18n.t('review.prepromptYes'), value: true },
      ],
    });
    if (!yes) return true;
  }
  return showReviewSheet({ demo: p.demo });
}

/**
 * Profile > Rate VolleyLive: the native sheet when Play supports it, else the Play Store app
 * (market://), else the Play Store website. Not live until the app is published (see top).
 */
export async function openStoreListing(opts: { demo?: boolean } = {}): Promise<'native' | 'market' | 'web' | 'demo' | 'none'> {
  if (opts.demo ?? DEMO_MODE) {
    await showDemoReviewSheet();
    return 'demo';
  }
  try {
    if ((await StoreReview.hasAction()) && (await StoreReview.isAvailableAsync())) {
      await StoreReview.requestReview();
      return 'native';
    }
  } catch {
    // fall through to the links
  }
  try {
    if (await Linking.canOpenURL(PLAY_MARKET_URL)) {
      await Linking.openURL(PLAY_MARKET_URL);
      return 'market';
    }
  } catch {
    // fall through
  }
  try {
    await Linking.openURL(PLAY_WEB_URL);
    return 'web';
  } catch {
    return 'none';
  }
}
