/**
 * 1.4.21 Appearance (spec §4 #18, mockups day-/night-08-appearance.png): Auto / Day / Night radio cards (selection
 * saves, 250 ms fade) + the "Sunset & floodlight animation" switch. Auto = time only (06:00–17:59 Day).
 */
import React from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { msToNextBoundary, THEME_SETTINGS, timeTheme, type ThemeSetting } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { useHiFont } from '../theme/useHiFont';
import { tokens } from '../theme/tokens';
import { Body, Over, Sticker, useKit } from '../components/DNKit';

const ICON: Record<ThemeSetting, React.ComponentProps<typeof Ionicons>['name']> = { auto: 'time-outline', day: 'sunny-outline', night: 'moon-outline' };

export default function AppearanceScreen() {
  const { t: tr, i18n } = useTranslation();
  const { t, name, setting, setSetting, animate, setAnimate, now } = useTheme();
  const f = useHiFont();
  const lang = i18n.language?.startsWith('hi') ? 'hi' : 'en';
  const next = new Date(now.getTime() + msToNextBoundary(now));
  const time = next.toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
  const themeName = (n: 'day' | 'night') => tr(`appearance.name.${n}`);
  const k = useKit();
  // mini theme thumbnail drawn from the real tokens of that theme (no image assets)
  const Thumb = ({ s }: { s: ThemeSetting }) => {
    const d = tokens.day, n = tokens.night;
    const box = { width: 46, height: 56, borderRadius: 12, borderWidth: k.day ? 2 : 1, borderColor: k.day ? t.outline : t.surface2, overflow: 'hidden' as const };
    if (s === 'auto') return <View style={[box, { flexDirection: 'row' }]}><View style={{ flex: 1, backgroundColor: d.accent }} /><View style={{ flex: 1, backgroundColor: n.bg }} /></View>;
    const th = s === 'day' ? d : n;
    return (
      <View style={[box, { backgroundColor: th.bg, padding: 6, justifyContent: 'space-between' }]}>
        <View style={{ height: 6, width: 22, borderRadius: 3, backgroundColor: th.primary }} />
        <View style={{ height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: th.outline, backgroundColor: th.surface }} />
        <View style={{ height: 6, borderRadius: 3, backgroundColor: s === 'day' ? th.accent : th.teamB }} />
      </View>
    );
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} testID="appearance">
      {/* 1.4.22 (spec v2 *-08): NOW SHOWING card */}
      <Sticker fill={k.day ? t.surface2 : t.surface} testID="appearance-now-card" inner={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: k.day ? t.accent : t.bg, borderWidth: k.day ? 2 : 1, borderColor: k.day ? t.outline : t.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={name === 'day' ? 'sunny' : 'flashlight'} size={28} color={name === 'day' ? t.text : t.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Over color={k.day ? undefined : t.primary}>{tr('dn.nowShowing')}</Over>
          <Text style={[{ color: t.text, fontSize: 17, marginTop: 2 }, f.bold]} testID="appearance-now">
            {setting === 'auto' ? tr('appearance.now', { theme: themeName(name) }) : themeName(name)}
          </Text>
          {setting === 'auto' ? <Body size={13} muted={!k.day} testID="appearance-next">{tr('appearance.switchesAt', { time, theme: themeName(timeTheme(next)) })}</Body> : null}
        </View>
      </Sticker>
      <Over style={{ marginTop: 6 }}>{tr('dn.themeLabel')}</Over>
      <View accessibilityRole="radiogroup" style={{ gap: 12 }}>
        {THEME_SETTINGS.map((s) => {
          const on = setting === s;
          return (
            <Pressable key={s} onPress={() => setSetting(s)} accessibilityRole="radio" accessibilityState={{ checked: on }} testID={`appearance-${s}`}>
              <Sticker highlight={on} fill={on && k.day ? t.accent : t.surface} inner={[{ minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }, on && !k.day ? { shadowColor: t.primary, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : null]}>
                <Thumb s={s} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <Text style={[{ color: t.text, fontSize: 17 }, f.bold]}>{tr(`appearance.${s}`)}</Text>
                    {s === 'auto' ? (
                      <View style={{ backgroundColor: k.day ? t.text : t.surface2, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={[{ color: k.day ? t.accent : t.primary, fontSize: 11 }, f.bold, { textTransform: 'uppercase' }]}>{tr('appearance.recommended')}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[{ color: on && k.day ? t.text : t.textMuted, fontSize: 13, marginTop: 2 }, f.body]}>{tr(`appearance.${s}Desc`)}</Text>
                </View>
                <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: on && !k.day ? t.primary : t.text, alignItems: 'center', justifyContent: 'center', backgroundColor: on && k.day ? t.surface : 'transparent' }}>
                  {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: k.day ? t.text : t.primary }} /> : null}
                </View>
              </Sticker>
            </Pressable>
          );
        })}
      </View>
      <Over style={{ marginTop: 6 }}>{tr('dn.motion')}</Over>
      <Sticker inner={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={[{ color: t.text, fontSize: 15 }, f.bold]}>{tr('appearance.anim')}</Text>
          <Text style={[{ color: t.textMuted, fontSize: 13, marginTop: 2 }, f.body]}>{tr('appearance.animDesc')}</Text>
        </View>
        <Switch value={animate} onValueChange={setAnimate} accessibilityLabel={tr('appearance.anim')} testID="appearance-anim" trackColor={{ true: k.day ? t.text : t.primary, false: t.surface2 }} thumbColor={k.day ? t.accent : t.bg} />
      </Sticker>
    </ScrollView>
  );
}
