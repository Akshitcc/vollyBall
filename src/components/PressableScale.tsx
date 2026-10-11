import React, { useState } from 'react';
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from '../hooks/useReduceMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Scale while pressed (default 0.96; cards 0.98, tiles 0.92–0.94, team halves 0.97). */
  scaleTo?: number;
};

/**
 * Shared press feedback (design-spec §6 `press`): 90 ms scale-down, spring back (damping 14,
 * stiffness 320). With Reduce Motion on (OS setting / prefers-reduced-motion) the scale is replaced
 * by a short opacity dip. Same API as Pressable, including function styles.
 */
export function PressableScale({ style, scaleTo = 0.96, onPressIn, onPressOut, disabled, children, ...rest }: Props) {
  const reduce = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const v = useSharedValue(1);
  const anim = useAnimatedStyle(() => (reduce ? { opacity: v.value } : { transform: [{ scale: v.value }] }));
  const resolved = typeof style === 'function' ? style({ pressed }) : style;
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e: GestureResponderEvent) => {
        setPressed(true);
        if (!disabled) v.value = withTiming(reduce ? 0.7 : scaleTo, { duration: reduce ? 150 : 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        v.value = reduce ? withTiming(1, { duration: 150 }) : withSpring(1, { damping: 14, stiffness: 320 });
        onPressOut?.(e);
      }}
      style={[resolved, anim]}
    >
      {children as React.ReactNode}
    </AnimatedPressable>
  );
}
