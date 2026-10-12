/**
 * In-app dialog (web): replaces the browser's own OK/Cancel box so the buttons are translated and
 * styled like the app (fix re-test 204). DialogHost in the root layout renders the open dialog.
 */
import { useEffect, useState } from 'react';

export type DialogButton = { text: string; style?: 'cancel' | 'destructive' | 'default'; value: boolean };
export type DialogSpec = { title: string; message: string; buttons: DialogButton[]; /** web: testID focused after closing if the opener is gone */ returnFocusTo?: string };
type Open = DialogSpec & { resolve: (v: boolean) => void };

const listeners = new Set<(d: Open | null) => void>();
const changeListeners = new Set<() => void>();
let current: Open | null = null;
const set = (d: Open | null) => {
  current = d;
  listeners.forEach((l) => l(d));
  changeListeners.forEach((l) => l());
};

/** 1.4.0 (V139-7): is a dialog open (state/uiBusy.ts). */
export const dialogOpen = () => current != null;
export function onDialogChange(l: () => void): () => void {
  changeListeners.add(l);
  return () => {
    changeListeners.delete(l);
  };
}

/** Opens the dialog; resolves with the pressed button's value (false when dismissed). */
export function openDialog(spec: DialogSpec): Promise<boolean> {
  current?.resolve(false); // only one at a time
  return new Promise((resolve) => set({ ...spec, resolve }));
}

export function closeDialog(value: boolean) {
  const d = current;
  set(null);
  d?.resolve(value);
}

export function useDialog(): Open | null {
  const [d, setD] = useState(current);
  useEffect(() => {
    listeners.add(setD);
    setD(current);
    return () => {
      listeners.delete(setD);
    };
  }, []);
  return d;
}
