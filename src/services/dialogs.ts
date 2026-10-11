/**
 * Confirm / notify dialogs on every platform: native uses the system Alert; web uses the app's own
 * translated dialog (DialogHost), not the browser's OK/Cancel box. Labels default to
 * common.cancel / common.yes / common.ok.
 */
import { Alert, Platform } from 'react-native';
import i18n from '../i18n';
import { openDialog } from '../state/dialog';

/** `returnFocusTo` (web): testID of the element to focus after closing when the opener is gone (a menu item). */
export function confirmAsk(
  message: string,
  opts: { title?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; returnFocusTo?: string } = {},
): Promise<boolean> {
  const title = opts.title ?? i18n.t('common.areYouSure');
  const cancel = opts.cancelLabel ?? i18n.t('common.cancel');
  const confirm = opts.confirmLabel ?? i18n.t('common.yes');
  const destructive = opts.destructive !== false;
  if (Platform.OS === 'web') {
    return openDialog({ title, message, returnFocusTo: opts.returnFocusTo, buttons: [{ text: cancel, style: 'cancel', value: false }, { text: confirm, style: destructive ? 'destructive' : 'default', value: true }] });
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirm, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}

export function notify(title: string, message: string) {
  if (Platform.OS === 'web') void openDialog({ title, message, buttons: [{ text: i18n.t('common.ok'), value: true }] });
  else Alert.alert(title, message);
}
