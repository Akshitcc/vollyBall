import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { BEACH_RULES, INDOOR_RULES, type RuleSet, fitDecidingSwitch } from '../core/rules';
import { describeRulesT } from '../i18n/format';
import { Chip, styles as ui } from './ui';
import { colors } from '../theme';

function Stepper({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (n: number) => void }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={ui.label}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {options.map((o) => (
          <Chip key={o} label={String(o)} active={value === o} onPress={() => onChange(o)} />
        ))}
      </View>
    </View>
  );
}

export function RulesEditor({ value, onChange }: { value: RuleSet; onChange: (r: RuleSet) => void }) {
  const { t } = useTranslation();
  const set = (patch: Partial<RuleSet>) => onChange(fitDecidingSwitch({ ...value, ...patch, preset: patch.preset ?? 'custom' }, patch));
  return (
    <View>
      <Text style={ui.label}>{t('rules.title')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
        <Chip label={t('rules.indoor')} active={value.preset === 'indoor'} onPress={() => onChange({ ...INDOOR_RULES })} />
        <Chip label={t('rules.beach')} active={value.preset === 'beach'} onPress={() => onChange({ ...BEACH_RULES })} />
        <Chip label={t('rules.custom')} active={value.preset === 'custom'} onPress={() => set({})} />
      </View>
      <Text style={{ color: colors.muted, fontWeight: '600', marginBottom: 10 }}>{describeRulesT(value, t)}</Text>
      {value.preset === 'custom' && (
        <>
          <Stepper label={t('rules.bestOf')} value={value.bestOf} options={[1, 3, 5]} onChange={(n) => set({ bestOf: n as 1 | 3 | 5 })} />
          <Stepper label={t('rules.pointsPerSet')} value={value.pointsPerSet} options={[11, 15, 21, 25]} onChange={(n) => set({ pointsPerSet: n })} />
          <Stepper label={t('rules.decidingSetTo')} value={value.decidingSetPoints} options={[11, 15, 21, 25]} onChange={(n) => set({ decidingSetPoints: n })} />
          <Stepper label={t('rules.winBy')} value={value.winBy} options={[1, 2]} onChange={(n) => set({ winBy: n })} />
          <Stepper label={t('rules.timeoutsPerSet')} value={value.timeoutsPerSet} options={[0, 1, 2, 3]} onChange={(n) => set({ timeoutsPerSet: n })} />
        </>
      )}
    </View>
  );
}
