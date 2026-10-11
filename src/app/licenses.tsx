/**
 * 1.3.8 (QA V137-7) About > Open-source licenses: every package in the app's production dependency tree
 * (generated offline at build time by scripts/gen-licenses.js), searchable, each with its declared licence
 * and – tap to expand – the full licence/notice text the package ships.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { filterLicenses, licenseText, type LicenseData, type LicensePackage } from '../core/licenses';
import licenses from '../generated/licenses.json';
import { colors, type } from '../theme';

const DATA = licenses as LicenseData;

function Row({ p, open, onToggle }: { p: LicensePackage; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const text = licenseText(DATA, p);
  const key = `${p.name}@${p.version}`;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 8 }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${p.name} ${p.version}, ${p.license}`} testID={`license-${key}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: colors.text, fontWeight: '700' }]} selectable>
            {p.name} <Text style={{ color: colors.muted, fontWeight: '400' }}>{p.version}</Text>
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>{p.license}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {open ? (
        <View testID={`license-text-${key}`} style={{ marginTop: 6 }}>
          {p.repository || p.homepage ? <Text style={[type.caption, { color: colors.muted, marginBottom: 6 }]} selectable>{p.homepage || p.repository}</Text> : null}
          <Text style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 15, color: colors.text }} selectable>
            {text ?? t('aboutPage.licenseNoText')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function LicensesScreen() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => filterLicenses(DATA.packages, q), [q]);
  return (
    <FlatList
      testID="licenses-screen"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={list}
      keyExtractor={(p) => `${p.name}@${p.version}`}
      initialNumToRender={20}
      windowSize={7}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ marginBottom: 10 }}>
          <Text style={[type.body, { color: colors.text, fontWeight: '700' }]} testID="licenses-count">{t('aboutPage.licenses', { count: DATA.packages.length })}</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{t('aboutPage.licensesNote')}</Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]}>{t('aboutPage.licensesNative')}</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('aboutPage.licensesSearch')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('aboutPage.licensesSearch')}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={60}
            testID="licenses-search"
            style={{ marginTop: 10, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12, color: colors.text }}
          />
        </View>
      }
      ListEmptyComponent={<Text style={[type.body, { color: colors.muted }]}>{t('aboutPage.licensesNoMatch')}</Text>}
      renderItem={({ item }) => {
        const k = `${item.name}@${item.version}`;
        return <Row p={item} open={open === k} onToggle={() => setOpen((o) => (o === k ? null : k))} />;
      }}
    />
  );
}
