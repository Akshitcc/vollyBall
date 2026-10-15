import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { closeDialog, useDialog, type DialogButton } from '../state/dialog';
import { colors, currentTheme } from '../theme';
import { tokens } from '../theme/tokens';

type Focusable = { focus?: () => void };

/**
 * Which button gets keyboard focus when the dialog opens: the safe one (Cancel / "Keep playing")
 * when there is a destructive choice, otherwise the primary one (the last non-cancel button).
 */
export function initialFocusIndex(buttons: readonly DialogButton[]): number {
  if (buttons.some((b) => b.style === 'destructive')) {
    const safe = buttons.findIndex((b) => b.style === 'cancel');
    if (safe >= 0) return safe;
  }
  for (let i = buttons.length - 1; i >= 0; i--) if (buttons[i].style !== 'cancel') return i;
  return Math.max(0, buttons.length - 1);
}

/**
 * Renders the in-app dialog (state/dialog.ts). Tapping outside or Escape counts as cancel.
 * Web keyboard support (fix re-test 209): focus moves to the safe/primary button on open, Tab and
 * Shift+Tab stay inside the dialog, Escape cancels, and focus returns to where it was afterwards.
 */
export function DialogHost() {
  const d = useDialog();
  useEffect(() => {
    if (!d || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const before = document.activeElement as (Element & { focus?: () => void }) | null;
    // react-native-web mounts the Modal's portal a commit later, so look the buttons up in the DOM
    const buttons = () => Array.from(document.querySelectorAll?.('[data-testid^="app-dialog-btn-"]') ?? []) as unknown as Focusable[];
    const first = initialFocusIndex(d.buttons);
    // Keep putting focus on the button for the first ~0.5 s: a menu that opened this dialog (itself a
    // Modal) hands focus back to its own opener as it closes, after we've focused ours.
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const focusFirst = () => {
      const list = buttons();
      const inside = list.some((b) => b === (document.activeElement as unknown));
      if (list[first] && !inside) list[first].focus?.();
      if (tries++ < 30) timer = setTimeout(focusFirst, 16);
    };
    timer = setTimeout(focusFirst, 0);
    // Where focus goes back to: the element focused before opening, or – when that is gone (a menu
    // item) – the element the caller named (returnFocusTo), else the last element outside the dialog
    // that took focus meanwhile.
    let lastOutside: (Element & { focus?: () => void }) | null = null;
    const onFocusIn = (e: Event) => {
      const el = e.target as (Element & { focus?: () => void; closest?: (s: string) => Element | null }) | null;
      if (el && el !== (document.body as unknown) && !el.closest?.('[data-testid="app-dialog"]') && !buttons().includes(el as unknown as Focusable)) lastOutside = el;
    };
    document.addEventListener('focusin', onFocusIn, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeDialog(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = buttons();
      if (!list.length) return;
      e.preventDefault();
      const at = list.findIndex((b) => b === (document.activeElement as unknown));
      const next = at < 0 ? (e.shiftKey ? list.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + list.length) % list.length;
      list[next].focus?.();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      const named = d.returnFocusTo ? (document.querySelector?.(`[data-testid="${d.returnFocusTo}"]`) as (Element & { focus?: () => void }) | null) : null;
      const target = [before, named, lastOutside].find((el) => el && typeof el.focus === 'function' && document.contains?.(el));
      if (target) setTimeout(() => target.focus?.(), 0);
    };
  }, [d]);
  if (!d) return null;
  // 1.4.23 (QA V1422-6): the dialog card, text and buttons come from the spec tokens of the current theme (it was
  // a hard-coded white card with Night's light text on it – unreadable).
  const T = tokens[currentTheme()];
  const day = currentTheme() === 'day';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => closeDialog(false)}>
      <Pressable onPress={() => closeDialog(false)} accessible={false} style={{ flex: 1, backgroundColor: T.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable
          onPress={() => {}}
          accessible={false}
          testID="app-dialog"
          accessibilityRole="alert"
          accessibilityViewIsModal
          aria-modal
          aria-labelledby="app-dialog-title"
          style={{ width: '100%', maxWidth: 380, backgroundColor: T.surface, borderRadius: T.radius.card, borderWidth: day ? 2 : 1, borderColor: day ? T.outline : T.surface2, padding: 20 }}
        >
          <Text nativeID="app-dialog-title" style={{ fontSize: 18, fontWeight: '900', color: T.text, marginBottom: 8 }} testID="app-dialog-title">
            {d.title}
          </Text>
          {!!d.message && (
            <Text style={{ fontSize: 15, color: T.text, marginBottom: 18 }} testID="app-dialog-message">
              {d.message}
            </Text>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            {d.buttons.map((b, i) => {
              const danger = b.style === 'destructive';
              const ghost = b.style === 'cancel';
              return (
                <Pressable
                  key={i}
                  onPress={() => closeDialog(b.value)}
                  accessibilityRole="button"
                  testID={`app-dialog-btn-${i}`}
                  style={((s: { focused?: boolean }) => { const focused = s.focused; return {
                    minHeight: 44,
                    paddingHorizontal: 16,
                    justifyContent: 'center',
                    borderRadius: 12,
                    backgroundColor: danger ? T.live : ghost ? 'transparent' : T.primary,
                    borderWidth: ghost ? 2 : 0,
                    borderColor: T.text,
                    // visible keyboard focus ring
                    outlineStyle: focused ? 'solid' : undefined,
                    outlineWidth: focused ? 3 : undefined,
                    outlineColor: focused ? (day ? T.teamAText : T.primary) : undefined,
                    outlineOffset: focused ? 2 : undefined,
                  }; }) as never}
                >
                  <Text style={{ fontWeight: '800', fontSize: 15, color: ghost ? T.text : danger ? T.onLive : T.onPrimary }} testID={`app-dialog-btn-text-${i}`}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
