import React, { useState } from 'react';
import { LIMITS } from '../../core/limits';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { LocationPicker, placeReady } from '../../components/LocationPicker';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Button, Chip, Field, Row, styles as ui } from '../../components/ui';
import type { Place } from '../../core/geo';
import type { Court } from '../../core/types';
import { backend } from '../../services/backend';
import { goBackOr } from '../../services/nav';
import { useMe } from '../../state/AuthContext';
import { surfaceLabel, translateError } from '../../i18n/format';
import { colors } from '../../theme';

export default function NewCourt() {
  const { t } = useTranslation();
  const me = useMe();
  const [name, setName] = useState('');
  const [surface, setSurface] = useState<Court['surface']>('outdoor');
  const [location, setLocation] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || !location) return setError(t('court.required'));
    if (!placeReady(location)) return setError(t('location.nameRequired'));
    setError(null);
    setBusy(true);
    try {
      await backend.addCourt({ name: name.trim(), surface, location, addedBy: me.id });
      goBackOr('/map');
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAwareScreen edges={[]}>
      <Field label={t('court.name')} value={name} onChangeText={setName} placeholder={t('court.namePlaceholder')} maxLength={LIMITS.courtName.max} testID="court-name" />
      <Text style={ui.label}>{t('court.surface')}</Text>
      <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {(['indoor', 'beach', 'grass', 'outdoor'] as const).map((s) => (
          <Chip key={s} label={surfaceLabel(s, t)} active={surface === s} onPress={() => setSurface(s)} />
        ))}
      </Row>
      <LocationPicker value={location} onChange={setLocation} />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={t('court.save')} icon="checkmark" big onPress={save} loading={busy} />
    </KeyboardAwareScreen>
  );
}
