/**
 * 1.3.8 (QA V137-11): one way to share text everywhere (fact of the day, match result, live link).
 *  - Android / iOS: the system share sheet; if it can't open, a "Couldn't share" toast.
 *  - Web: the browser's share sheet where there is one (phones); otherwise – or if it fails – the text is
 *    copied to the clipboard with a "Copied" toast; if even that fails, a "Couldn't share" toast.
 * Closing the sheet without sharing is not an error (no toast).
 */
import { Platform, Share } from 'react-native';
import i18n from '../i18n';
import { showToast } from '../state/toast';

export type ShareResult = 'shared' | 'dismissed' | 'copied' | 'failed';

type WebNav = { share?: (d: { text: string }) => Promise<void>; clipboard?: { writeText?: (t: string) => Promise<void> } };

export async function shareOrCopy(message: string, platform: string = Platform.OS): Promise<ShareResult> {
  if (platform === 'web') {
    const nav = (globalThis as { navigator?: WebNav }).navigator;
    if (typeof nav?.share === 'function') {
      try {
        await nav.share({ text: message });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return 'dismissed';
        // NotAllowedError etc.: fall back to the clipboard
      }
    }
    try {
      if (typeof nav?.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await nav.clipboard.writeText(message);
      showToast(i18n.t('share.copied'));
      return 'copied';
    } catch {
      showToast(i18n.t('share.failed'));
      return 'failed';
    }
  }
  try {
    const r = await Share.share({ message });
    return r?.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    showToast(i18n.t('share.failed'));
    return 'failed';
  }
}
