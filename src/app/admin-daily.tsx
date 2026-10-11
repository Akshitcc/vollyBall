/**
 * 1.3.7 Admin only: manage the Home "Fact of the day" items (add / edit / delete / turn on-off).
 * The server (ADMIN_UIDS) and firestore.rules (admin claim) enforce admin-only writes; the demo uses
 * the demo admin. Quotes need a verified attribution and an https source URL.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Switch, Text, View } from 'react-native';
import { EmptyCard } from '../components/Hero';
import { Button, Card, Chip, Field } from '../components/ui';
import { checkDailyItem, DAILY_LIMITS, type DailyItem, type DailyItemType } from '../core/dailyItems';
import { translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { confirmAsk } from '../services/dialogs';
import { useAuth } from '../state/AuthContext';
import { colors, type } from '../theme';

const EMPTY: Partial<DailyItem> = { type: 'fact', textEn: '', textHi: '', attribution: '', sourceUrl: '', active: true };

export default function AdminDailyScreen() {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const [list, setList] = useState<DailyItem[] | null>(null);
  const [edit, setEdit] = useState<Partial<DailyItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.listDailyItems({ all: true }).then(setList).catch((e) => setError(translateError(e, t)));
  }, [t]);
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);
  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
      load();
      return true;
    } catch (e) {
      setError(translateError(e, t));
      return false;
    }
  };
  const save = async () => {
    if (!edit) return;
    try {
      checkDailyItem(edit);
    } catch (e) {
      const field = (e as { field?: string }).field ?? '';
      setError(t('daily.invalid', { field: t(`daily.fields.${field}`, { defaultValue: field }) }));
      return;
    }
    if (await run(() => backend.saveDailyItem(edit))) setEdit(null);
  };
  if (!isAdmin) return <EmptyCard icon="lock-closed-outline" title={t('errors.codes.admin_only')} />;
  const set = (k: keyof DailyItem) => (v: string) => setEdit((e) => ({ ...e, [k]: v }));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="admin-daily">
      <Text style={[type.caption, { color: colors.muted, marginBottom: 10 }]}>{t('daily.adminNote')}</Text>
      {error ? (
        <Text style={[type.body, { color: colors.danger, marginBottom: 8 }]} accessibilityRole="alert" testID="daily-error">
          {error}
        </Text>
      ) : null}
      {edit ? (
        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {(['fact', 'quote'] as DailyItemType[]).map((k) => (
              <Chip key={k} label={t(`daily.type.${k}`)} active={edit.type === k} onPress={() => setEdit((e) => ({ ...e, type: k }))} testID={`daily-type-${k}`} />
            ))}
          </View>
          <Field label={t('daily.fields.textEn')} value={edit.textEn ?? ''} onChangeText={set('textEn')} multiline maxLength={DAILY_LIMITS.text} testID="daily-text-en" />
          <Field label={t('daily.fields.textHi')} value={edit.textHi ?? ''} onChangeText={set('textHi')} multiline maxLength={DAILY_LIMITS.text} testID="daily-text-hi" />
          <Field label={t('daily.fields.attribution')} hint={edit.type === 'quote' ? t('daily.quoteRule') : undefined} value={edit.attribution ?? ''} onChangeText={set('attribution')} maxLength={DAILY_LIMITS.attribution} testID="daily-attr" />
          <Field label={t('daily.fields.sourceUrl')} value={edit.sourceUrl ?? ''} onChangeText={set('sourceUrl')} autoCapitalize="none" keyboardType="url" maxLength={DAILY_LIMITS.url} testID="daily-url" />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[type.body, { color: colors.text }]}>{t('daily.active')}</Text>
            <Switch value={edit.active !== false} onValueChange={(v) => setEdit((e) => ({ ...e, active: v }))} accessibilityLabel={t('daily.active')} testID="daily-active" />
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setEdit(null)} style={{ flex: 1 }} testID="daily-cancel" />
            <Button title={t('daily.save')} onPress={() => void save()} style={{ flex: 1 }} testID="daily-save" />
          </View>
        </Card>
      ) : (
        <Button title={t('daily.add')} icon="add" onPress={() => setEdit({ ...EMPTY })} style={{ marginBottom: 14 }} testID="daily-add" />
      )}
      {(list ?? []).map((x) => (
        <Card key={x.id} style={{ marginBottom: 10, opacity: x.active ? 1 : 0.6 }}>
          <Text style={[type.caption, { color: colors.muted }]}>
            {t(`daily.type.${x.type}`)} · {x.active ? t('daily.on') : t('daily.off')}
          </Text>
          <Text style={[type.body, { color: colors.text, marginTop: 4 }]} testID={`daily-item-${x.id}`}>{x.textEn}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 2 }]}>{x.textHi}</Text>
          {x.attribution ? <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{x.attribution}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Button title={t('daily.edit')} variant="secondary" onPress={() => setEdit({ ...x, attribution: x.attribution ?? '', sourceUrl: x.sourceUrl ?? '' })} style={{ flex: 1 }} testID={`daily-edit-${x.id}`} />
            <Button title={x.active ? t('daily.turnOff') : t('daily.turnOn')} variant="secondary" onPress={() => void run(() => backend.saveDailyItem({ ...x, active: !x.active }))} style={{ flex: 1 }} testID={`daily-toggle-${x.id}`} />
            <Button
              title={t('daily.delete')}
              variant="danger"
              onPress={async () => {
                if (await confirmAsk(t('daily.deleteConfirm'))) void run(() => backend.deleteDailyItem(x.id));
              }}
              style={{ flex: 1 }}
              testID={`daily-delete-${x.id}`}
            />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
