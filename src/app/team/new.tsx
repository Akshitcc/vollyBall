import { router } from 'expo-router';
import { LIMITS } from '../../core/limits';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Button, LimitedField, P, styles as ui } from '../../components/ui';
import { cleanText } from '../../core/text';
import { TEAM_COLORS } from '../../core/types';
import { backend } from '../../services/backend';
import { useMe } from '../../state/AuthContext';
import { swatchLabel, translateError } from '../../i18n/format';
import { colors, swatchRing } from '../../theme';

export default function NewTeam() {
  const { t } = useTranslation();
  const me = useMe();
  const [name, setName] = useState('');
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const len = cleanText(name).length;
    if (len === 0) return setError(t('newTeam.nameRequired'));
    // QA B121-7: a 1-character name says it's too short (not "give your team a name").
    if (len < LIMITS.teamName.min) return setError(t('newTeam.nameTooShort', { min: LIMITS.teamName.min }));
    setBusy(true);
    try {
      const id = await backend.createTeam({
        name: name.trim(),
        color,
        captainId: me.id,
        memberIds: [me.id],
        subIds: [],
        pendingPhones: [],
        city: me.city ?? '',
      });
      router.replace(`/team/${id}`);
    } catch (e) {
      setError(translateError(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScreen edges={[]}>
      <P muted style={{ marginBottom: 16 }}>{t('newTeam.intro')}</P>
      <LimitedField
        label={t('newTeam.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError(null);
        }}
        placeholder={t('newTeam.namePlaceholder')}
        autoCapitalize="words"
        max={LIMITS.teamName.max}
        min={LIMITS.teamName.min}
        cutText={t('common.pasteCut', { max: LIMITS.teamName.max })}
        shortText={t('newTeam.nameTooShort', { min: LIMITS.teamName.min })}
        testID="team-name"
      />
      <Text style={ui.label}>{t('newTeam.colour')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
        {TEAM_COLORS.map((c) => (
          // QA B121-6: the selection ring sits outside the swatch with a gap (visible on navy too) and a
          // navy swatch carries the contrast ring.
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            accessibilityRole="radio"
            accessibilityState={{ selected: color === c }}
            accessibilityLabel={swatchLabel(c, t)}
            testID={`team-colour-${c.slice(1)}`}
            style={{ width: 52, height: 52, borderRadius: 26, marginRight: 6, marginBottom: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: color === c ? colors.primaryText : 'transparent' }}
          >
            <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: c }, swatchRing(c)]} testID={`team-colour-fill-${c.slice(1)}`} />
          </Pressable>
        ))}
      </View>
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={t('newTeam.create')} icon="people" big onPress={create} loading={busy} />
    </KeyboardAwareScreen>
  );
}
