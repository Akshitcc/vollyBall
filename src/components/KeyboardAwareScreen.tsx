/**
 * KeyboardAwareScreen – the wrapper every form screen uses so the on-screen keyboard never hides
 * the focused input or its submit button (Android APK on a Realme phone hid the login phone field).
 *
 * - KeyboardAvoidingView: behavior 'padding' on iOS, 'height' on Android. android.softwareKeyboardLayoutMode
 *   is left at Expo's default and *not* relied on: with edge-to-edge (RN 0.86 / SDK 57) the window no
 *   longer resizes for the keyboard. KeyboardAvoidingView only removes the part of itself the keyboard
 *   actually overlaps, so even where the window does resize nothing is compensated twice.
 * - ScrollView with keyboardShouldPersistTaps="handled" so tapping Continue/Add while the keyboard is up
 *   presses the button instead of only closing the keyboard.
 * - When the keyboard opens (or another input gets focus while it is open) the focused input is
 *   scrolled into view with room below it for the button that follows (`keyboardOffset`).
 * - 1.3.2: an optional sticky `footer` (SafeFooter) under the scroll area, inside the
 *   KeyboardAvoidingView so it rises with the keyboard; without a footer the scroll content gets the
 *   bottom safe-area inset so its last button never sits under the Android nav bar.
 * - 1.4.6 (QA V145-13): `hideFooterOnKeyboard` hides the sticky footer while the keyboard is open (native keyboard
 *   events; on the web the visual viewport shrinking), and ScrollRevealContext lets content scroll a view (e.g. the
 *   search results under a focused field) into view above the keyboard / footer.
 * - 1.4.7 (QA V146-6): on the web the keyboard overlays the page – the layout viewport (and so this ScrollView) keeps
 *   its height and only window.visualViewport shrinks. reveal() / the focused-input reveal therefore measure the
 *   node on screen (getBoundingClientRect) against the visible area (visualViewport offsetTop + height) and scroll
 *   by the difference; while the keyboard is open the content gets the hidden height as extra bottom padding so it
 *   can scroll that far. Native keeps the layout-based path (KeyboardAvoidingView already shrinks the viewport).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles as ui } from './ui';
import { useInsets } from './SafeFooter';
import { space } from '../theme';

export const KEYBOARD_BEHAVIOR: 'padding' | 'height' | undefined = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;
/** Space kept visible under the focused input (its error line + the submit button). */
export const DEFAULT_KEYBOARD_OFFSET = 140;

/** 1.4.6 (QA V145-13): scroll `node` (a host view inside the screen) into view with `below` px of room under it. */
export type ScrollReveal = (node: unknown, below?: number) => void;
export const ScrollRevealContext = createContext<ScrollReveal>(() => {});
/**
 * 1.4.9 (QA V148-7): wraps a message (an error, a refusal) so it scrolls into view when it appears or changes – also
 * while a field is focused (the keyboard's own reveal of the focused input runs first, so it reveals again later).
 */
export function RevealOnShow({ show, dep, below = 24, children, testID, style }: { show: boolean; dep?: unknown; below?: number; children: React.ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const reveal = useContext(ScrollRevealContext);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!show) return;
    const ids = [60, 400].map((ms) => setTimeout(() => reveal(ref.current, below), ms));
    return () => ids.forEach(clearTimeout);
  }, [show, dep, below, reveal]);
  if (!show) return null;
  return (
    <View ref={ref} testID={testID} style={style}>
      {children}
    </View>
  );
}
/** Web: the on-screen keyboard shrinks the visual viewport. */
export const webKeyboardOpen = (inner: number, visual: number): boolean => inner - visual > 120;
type VisualViewportLike = { height: number; offsetTop?: number };
/**
 * 1.4.7 (QA V146-6): how far to scroll (px, + = down) so that a node at `rect` (getBoundingClientRect: layout-viewport
 * coordinates) is visible inside the visual viewport with `below` px under it (and `above` px over it). 0 = visible.
 */
export const webRevealDelta = (rect: { top: number; bottom: number }, vv: VisualViewportLike, below: number, above = 8, clip?: { top: number; bottom: number } | null): number => {
  // the visible area: the visual viewport, clipped to the scroll view (a sticky footer / header sit outside it – V146-12)
  const top = Math.max(vv.offsetTop ?? 0, clip?.top ?? -Infinity);
  const bottom = Math.min((vv.offsetTop ?? 0) + vv.height, clip?.bottom ?? Infinity);
  if (rect.bottom + below > bottom) return Math.min(rect.bottom + below - bottom, Math.max(0, rect.top - top - above));
  if (rect.top - above < top) return rect.top - above - top;
  return 0;
};
/** The part of the layout viewport the web keyboard hides (0 when closed / not web). */
export const webHiddenBelow = (inner: number, vv: VisualViewportLike | null | undefined): number =>
  vv && webKeyboardOpen(inner, vv.height) ? Math.max(0, inner - ((vv.offsetTop ?? 0) + vv.height)) : 0;
/** 1.4.8 (QA V147-4): the focused text field in the DOM (web), if any. */
export const webFocusedInput = (): unknown => {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement as { tagName?: string } | null;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el : null;
};
const visualViewportOf = (): (VisualViewportLike & { addEventListener: Function; removeEventListener: Function }) | null =>
  Platform.OS === 'web' && typeof window !== 'undefined' ? ((window as unknown as { visualViewport?: VisualViewportLike & { addEventListener: Function; removeEventListener: Function } }).visualViewport ?? null) : null;

export function KeyboardAwareScreen({
  children,
  style,
  contentContainerStyle,
  edges = ['top'],
  padded = true,
  center = false,
  keyboardOffset = DEFAULT_KEYBOARD_OFFSET,
  header,
  footer,
  scrollKey,
  hideFooterOnKeyboard = false,
  testID = 'keyboard-aware-screen',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom')[];
  padded?: boolean;
  /** Vertically centre short content (login); it still scrolls when the keyboard leaves too little room. */
  center?: boolean;
  keyboardOffset?: number;
  /** Fixed content above the scrolling area (e.g. the login language switch). */
  header?: React.ReactNode;
  /** Sticky content below the scrolling area (a SafeFooter with the step buttons). */
  footer?: React.ReactNode;
  /** Scroll back to the top whenever this changes (e.g. the step of a multi-step form). */
  scrollKey?: string | number;
  /** 1.4.6 (QA V145-13): hide the footer while the keyboard is open (so it never covers what is typed / found). */
  hideFooterOnKeyboard?: boolean;
  testID?: string;
}) {
  const scroll = useRef<ScrollView>(null);
  const viewport = useRef(0);
  const offsetY = useRef(0);
  const keyboardUp = useRef(false);
  const [kbOpen, setKbOpen] = useState(false);
  const [webInset, setWebInset] = useState(0);

  /** Web (V146-6): scroll so the DOM node sits inside the visual viewport. true = handled. */
  const webReveal = useCallback((node: unknown, below: number): boolean => {
    const vv = visualViewportOf();
    const el = node as { getBoundingClientRect?: () => { top: number; bottom: number } } | null;
    const sv = scroll.current;
    if (!vv || !el?.getBoundingClientRect || !sv) return false;
    const host = (sv as unknown as { getScrollableNode?: () => { getBoundingClientRect?: () => { top: number; bottom: number } } | null }).getScrollableNode?.();
    const d = webRevealDelta(el.getBoundingClientRect(), vv, below, 8, host?.getBoundingClientRect?.() ?? null);
    if (d !== 0) sv.scrollTo({ y: Math.max(0, offsetY.current + d), animated: true });
    return true;
  }, []);

  const revealFocused = useCallback(() => {
    // 1.4.8 (QA V147-4): on web, the DOM's focused input when RN's focus registry has none (focus by tap / tab)
    const input = (TextInput.State.currentlyFocusedInput?.() ?? (Platform.OS === 'web' ? webFocusedInput() : null)) as unknown as { measureLayout?: Function } | null;
    const sv = scroll.current;
    const inner = (sv as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
    if (Platform.OS === 'web' && webReveal(input, keyboardOffset)) return;
    if (!input?.measureLayout || !sv || !inner) return;
    input.measureLayout(
      inner,
      (_x: number, y: number, _w: number, h: number) => {
        const bottom = y + h + keyboardOffset;
        if (bottom > offsetY.current + viewport.current) sv.scrollTo({ y: Math.max(0, bottom - viewport.current), animated: true });
        else if (y < offsetY.current) sv.scrollTo({ y: Math.max(0, y - space(4)), animated: true });
      },
      () => {},
    );
  }, [keyboardOffset, webReveal]);

  const reveal = useCallback<ScrollReveal>((node, below = space(6)) => {
    const n = node as { measureLayout?: Function } | null;
    const sv = scroll.current;
    const inner = (sv as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
    if (Platform.OS === 'web' && webReveal(n, below)) return;
    if (!n?.measureLayout || !sv || !inner) return;
    n.measureLayout(
      inner,
      (_x: number, y: number, _w: number, h: number) => {
        const bottom = y + h + below;
        if (bottom > offsetY.current + viewport.current) sv.scrollTo({ y: Math.max(0, bottom - viewport.current), animated: true });
      },
      () => {},
    );
  }, [webReveal]);

  useEffect(() => {
    const vv = visualViewportOf();
    if (!vv) return;
    const on = () => {
      const open = webKeyboardOpen(window.innerHeight, vv.height);
      keyboardUp.current = open;
      setKbOpen(open);
      setWebInset(webHiddenBelow(window.innerHeight, vv));
      if (open) setTimeout(revealFocused, 60);
    };
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, [revealFocused]);

  // 1.4.8 (QA V147-4): the keyboard inset (webInset) lengthens the scroll range only on the next render – the reveal
  // at keyboard-open ran before it, was clamped, and the focused search box came into view only on the first
  // keystroke. Reveal again once the inset is laid out.
  useEffect(() => {
    if (Platform.OS !== 'web' || !keyboardUp.current || webInset <= 0) return;
    const id = setTimeout(revealFocused, 30);
    return () => clearTimeout(id);
  }, [webInset, revealFocused]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      keyboardUp.current = true;
      setKbOpen(true);
      // Wait one frame for KeyboardAvoidingView to shrink the viewport first.
      setTimeout(revealFocused, Platform.OS === 'ios' ? 250 : 60);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardUp.current = false;
      setKbOpen(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [revealFocused]);

  const onLayout = (e: LayoutChangeEvent) => {
    viewport.current = e.nativeEvent.layout.height;
    if (keyboardUp.current) revealFocused();
  };

  const insets = useInsets();
  useEffect(() => {
    if (scrollKey !== undefined) scroll.current?.scrollTo?.({ y: 0, animated: false });
  }, [scrollKey]);
  // No footer and no bottom edge: the content itself clears the nav bar.
  const navPad = !footer && !edges.includes('bottom') ? insets.bottom : 0;
  const inner = padded ? { padding: space(4), paddingBottom: space(10) + navPad } : navPad ? { paddingBottom: navPad } : undefined;
  return (
    <SafeAreaView style={[ui.screen, style]} edges={edges} testID={testID}>
      {header}
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={{ flex: 1 }} testID={`${testID}-kav`}>
        <ScrollView
          ref={scroll}
          testID={`${testID}-scroll`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
          onLayout={onLayout}
          onScroll={(e) => (offsetY.current = e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={32}
          // Focus moving between inputs while the keyboard is open (no new keyboard event).
          onTouchEnd={() => keyboardUp.current && setTimeout(revealFocused, 60)}
          contentContainerStyle={[inner, center && { flexGrow: 1, justifyContent: 'center' }, contentContainerStyle, webInset > 0 && { paddingBottom: webInset + space(10) }]}
        >
          <ScrollRevealContext.Provider value={reveal}>
            <View>{children}</View>
          </ScrollRevealContext.Provider>
        </ScrollView>
        {hideFooterOnKeyboard && kbOpen ? null : footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
