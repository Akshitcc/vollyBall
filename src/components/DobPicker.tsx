/**
 * 1.3.6: date-of-birth picker (no typed age). Day / month / year columns in a modal; only real past
 * dates inside the allowed age range can be picked (core/registration.ts checks again on save).
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Modal } from './AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import { MAX_AGE, todayIST } from '../core/registration';
import { colors } from '../theme';
import { Button, styles as ui } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function DobPicker({ value, onChange, minAge, label, testID = 'dob', error }: { value: string; onChange: (v: string) => void; minAge: number; label: string; testID?: string; /** 1.3.7 (R136-15) inline error */ error?: string | null }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const thisYear = Number(todayIST().slice(0, 4));
  // 1.3.7 (R136-7): from the youngest allowed birth year (thisYear − minAge) down to thisYear − MAX_AGE − 1,
  // so everyone who is exactly MAX_AGE today (born late in that year) can be picked.
  const years = useMemo(() => Array.from({ length: MAX_AGE - minAge + 2 }, (_, i) => thisYear - minAge - i), [thisYear, minAge]);
  const init = value ? value.split('-').map(Number) : [thisYear - 20, 1, 1];
  const [y, setY] = useState(init[0]);
  const [m, setM] = useState(init[1]);
  const [d, setD] = useState(init[2]);
  // 1.3.7 (R136-21): full month names where they fit – the chosen date always; the picker column too
  // in Hindi (short Hindi month forms read oddly), short English names in the narrow column.
  const monthNames = (style: 'long' | 'short') => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2000, i, 1)).toLocaleDateString(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', { month: style, timeZone: 'UTC' }));
  const longMonths = monthNames('long');
  const months = i18n.language === 'hi' ? longMonths : monthNames('short');
  const maxD = daysIn(y, m);
  const shown = value ? `${Number(value.slice(8, 10))} ${longMonths[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : t('profileForm.dobPick');
  const col = (items: { key: number; label: string }[], sel: number, set: (n: number) => void, id: string) => (
    <ScrollView style={{ flex: 1, maxHeight: 260 }} testID={`${testID}-${id}`}>
      {items.map((it) => (
        <Pressable key={it.key} onPress={() => set(it.key)} testID={`${testID}-${id}-${it.key}`} accessibilityRole="button" accessibilityState={{ selected: sel === it.key }}
          style={{ paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: sel === it.key ? colors.ink : 'transparent' }}>
          <Text style={{ color: sel === it.key ? colors.white : colors.text, fontWeight: '700', fontSize: 16 }}>{it.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
  return (
    <View style={{ marginBottom: 16 }}>
      {/* R136-21: same label style (caps in English) as the other fields */}
      <Text style={ui.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}${error ? `, ${error}` : ''}`} aria-invalid={!!error}
        style={{ borderWidth: error ? 2 : 1.5, borderColor: error ? colors.danger : colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, backgroundColor: colors.white }}>
        <Text style={{ color: value ? colors.text : colors.muted, fontSize: 16, fontWeight: value ? '700' : '500' }}>{shown}</Text>
      </Pressable>
      {error ? (
        <Text style={[ui.hint, { color: colors.danger, fontWeight: '700' }]} accessibilityLiveRegion="polite" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 }}>
            <Text style={{ fontWeight: '800', fontSize: 17, color: colors.text, marginBottom: 8 }}>{t('profileForm.dobPick')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {col(Array.from({ length: maxD }, (_, i) => ({ key: i + 1, label: String(i + 1) })), Math.min(d, maxD), setD, 'day')}
              {col(months.map((label, i) => ({ key: i + 1, label })), m, setM, 'month')}
              {col(years.map((yy) => ({ key: yy, label: String(yy) })), y, setY, 'year')}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button title={t('profileForm.dobCancel')} variant="ghost" onPress={() => setOpen(false)} style={{ flex: 1 }} />
              <Button title={t('profileForm.dobDone')} onPress={() => { onChange(`${y}-${pad(m)}-${pad(Math.min(d, maxD))}`); setOpen(false); }} style={{ flex: 1 }} testID={`${testID}-done`} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
