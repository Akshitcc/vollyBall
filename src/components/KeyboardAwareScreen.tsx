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
 */
import React, { useCallback, useEffect, useRef } from 'react';
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
import { space } from '../theme';

export const KEYBOARD_BEHAVIOR: 'padding' | 'height' | undefined = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;
/** Space kept visible under the focused input (its error line + the submit button). */
export const DEFAULT_KEYBOARD_OFFSET = 140;

export function KeyboardAwareScreen({
  children,
  style,
  contentContainerStyle,
  edges = ['top'],
  padded = true,
  center = false,
  keyboardOffset = DEFAULT_KEYBOARD_OFFSET,
  header,
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
  testID?: string;
}) {
  const scroll = useRef<ScrollView>(null);
  const viewport = useRef(0);
  const offsetY = useRef(0);
  const keyboardUp = useRef(false);

  const revealFocused = useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput?.() as unknown as { measureLayout?: Function } | null;
    const sv = scroll.current;
    const inner = (sv as unknown as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
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
  }, [keyboardOffset]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      keyboardUp.current = true;
      // Wait one frame for KeyboardAvoidingView to shrink the viewport first.
      setTimeout(revealFocused, Platform.OS === 'ios' ? 250 : 60);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardUp.current = false;
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

  const inner = padded ? { padding: space(4), paddingBottom: space(10) } : undefined;
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
          contentContainerStyle={[inner, center && { flexGrow: 1, justifyContent: 'center' }, contentContainerStyle]}
        >
          <View>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
