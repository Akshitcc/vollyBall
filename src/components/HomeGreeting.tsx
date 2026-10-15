/** 1.4.21 Home greeting (spec §5): "Good evening, Aarav" – first name, EN/HI, live (the theme clock ticks each minute). */
import React from 'react';
import { Text, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { firstName, greeting } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { useHiFont } from '../theme/useHiFont';

export function greetingText(t: (k: string, o?: object) => string, name: string | null | undefined, d: Date): string {
  const first = firstName(name);
  return first ? t(`greet.${greeting(d)}`, { name: first }) : t(`greet.${greeting(d)}Bare`);
}
export function HomeGreeting({ name, style }: { name: string | null | undefined; style?: TextStyle }) {
  const { t } = useTranslation();
  const { now } = useTheme();
  const f = useHiFont();
  return <Text style={[style, f.body]} numberOfLines={1} testID="home-greeting">{greetingText(t as never, name, now)}</Text>;
}
