/**
 * Build a match side from registered players, one mobile number at a time.
 * As soon as the typed number is complete it is looked up (backend.findUserByPhone):
 * a registered user shows as a card (name + photo, never their number) with an Add button;
 * an unregistered number shows the register-first message and nothing is added.
 */
import { Ionicons } from '@expo/vector-icons';
import { LIMITS } from '../core/limits';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import { toE164 } from '../core/phone';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/roster';
import { PhoneInput } from './PhoneInput';
import { TEAM_COLORS, type MatchPlayer, type UserProfile } from '../core/types';
import { swatchLabel, translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { colors, contrast, radius, swatchRing } from '../theme';
import { Avatar, Button, Field, Row, styles as ui } from './ui';

export interface BuiltTeam {
  kind: 'build';
  name: string;
  color: string;
  players: MatchPlayer[];
}

type Lookup =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'found'; user: Pick<UserProfile, 'id' | 'name' | 'photoURL'> }
  | { state: 'notRegistered' }
  | { state: 'error'; message: string };

export function TeamBuilder({
  value,
  onChange,
  otherPlayerIds,
  otherColor,
  testID = 'team-builder',
  max = MAX_PLAYERS,
}: {
  /** 1.3.6: most players for the chosen team size (Exact 6 → 6, Custom → 12). */
  max?: number;
  /** The other side's colour: swatches under 3:1 against it are disabled (design-spec §8 05). */
  otherColor?: string | null;
  value: BuiltTeam;
  onChange: (v: BuiltTeam) => void;
  /** Players already on the other side (a player can't be on both teams). */
  otherPlayerIds: string[];
  testID?: string;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const seq = useRef(0);
  const full = value.players.length >= max;

  useEffect(() => {
    const n = toE164(phone);
    const mine = ++seq.current;
    if (!n) return setLookup({ state: 'idle' });
    setLookup({ state: 'looking' });
    const timer = setTimeout(() => {
      backend
        .findUserByPhone(n)
        .then((u) => {
          if (mine !== seq.current) return; // a newer number was typed meanwhile
          // Only what the card needs: no phone number of other users is kept or shown.
          setLookup(u ? { state: 'found', user: { id: u.id, name: u.name, photoURL: u.photoURL ?? null } } : { state: 'notRegistered' });
        })
        .catch((e) => mine === seq.current && setLookup({ state: 'error', message: translateError(e) }));
    }, 350);
    return () => clearTimeout(timer);
  }, [phone]);

  const found = lookup.state === 'found' ? lookup.user : null;
  const problem = !found
    ? null
    : value.players.some((p) => p.id === found.id)
      ? t('newMatch.alreadyAdded', { name: found.name })
      : otherPlayerIds.includes(found.id)
        ? t('newMatch.onOtherTeam', { name: found.name })
        : full
          ? t('newMatch.teamFull', { max })
          : null;

  const add = () => {
    if (!found || problem) return;
    onChange({ ...value, players: [...value.players, { id: found.id, name: found.name, photoURL: found.photoURL ?? null }] });
    setPhone('');
    setLookup({ state: 'idle' });
  };
  const remove = (id: string) => onChange({ ...value, players: value.players.filter((p) => p.id !== id) });
  const missing = Math.max(0, MIN_PLAYERS - value.players.length);

  return (
    <View testID={testID}>
      <Text style={[ui.hint, { marginBottom: 8 }]}>{t('newMatch.buildHint')}</Text>
      <Field label={t('newMatch.teamName')} value={value.name} onChangeText={(name) => onChange({ ...value, name })} placeholder={t('newMatch.teamNamePlaceholder')} maxLength={LIMITS.sideName.max} testID={`${testID}-name`} />
      <Text style={ui.label}>{t('newMatch.colour')}</Text>
      <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {TEAM_COLORS.map((c) => {
          const on = value.color === c;
          const clash = !!otherColor && !on && contrast(c, otherColor) < 3;
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: clash }}
              accessibilityLabel={swatchLabel(c, t)}
              disabled={clash}
              onPress={() => onChange({ ...value, color: c })}
              testID={`swatch-${testID}-${c.slice(1)}`}
              hitSlop={4}
              style={{ width: 40, height: 40, borderRadius: 20, marginRight: 6, marginBottom: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? colors.primaryText : 'transparent', opacity: clash ? 0.3 : 1 }}
            >
              <View style={[{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: 1, borderColor: colors.hairline }, swatchRing(c)]}>
                {clash && <View style={{ position: 'absolute', left: 14, top: -2, width: 2, height: 34, backgroundColor: colors.ink, transform: [{ rotate: '45deg' }] }} />}
              </View>
            </Pressable>
          );
        })}
      </Row>

      <Text style={ui.label}>
        {t('newMatch.playerCount', { count: value.players.length, max })}
      </Text>
      {value.players.map((p, i) => (
        <Row key={p.id} style={{ paddingVertical: 4 }}>
          <Text style={{ width: 22, fontWeight: '900', color: colors.muted }}>{i + 1}.</Text>
          <Avatar name={p.name} uri={p.photoURL} size={30} color={value.color} />
          <Text style={{ flex: 1, marginLeft: 8, fontWeight: '800', color: colors.text }} numberOfLines={1}>
            {p.name}
          </Text>
          <Pressable onPress={() => remove(p.id)} accessibilityRole="button" accessibilityLabel={t('newMatch.removePlayer', { name: p.name })} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </Pressable>
        </Row>
      ))}
      {missing > 0 && (
        <Text style={{ color: colors.danger, fontWeight: '700', marginVertical: 4 }} testID={`${testID}-need`}>
          {t('newMatch.needMore', { count: missing, min: MIN_PLAYERS })}
        </Text>
      )}

      {full && (
        <Text style={{ color: colors.muted, fontWeight: '700', marginVertical: 4 }} testID={`${testID}-full`}>
          {t('newMatch.fullHint', { max })}
        </Text>
      )}
      {!full && (
        <>
          <View style={{ marginTop: 8 }}>
            <PhoneInput digitsOnly label={t('newMatch.addPlayer')} value={phone} onChangeText={setPhone} testID={`${testID}-phone`} />
          </View>
        </>
      )}
      {lookup.state === 'looking' && <Text style={ui.hint}>{t('newMatch.lookingUp')}</Text>}
      {lookup.state === 'notRegistered' && (
        <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 8 }} testID={`${testID}-not-registered`}>
          {t('errors.notRegistered')}
        </Text>
      )}
      {lookup.state === 'error' && (
        <Text style={{ color: colors.danger, fontWeight: '700' }} testID={`${testID}-lookup-error`}>
          {lookup.message}
        </Text>
      )}
      {found && (
        <View
          testID={`${testID}-found`}
          style={{ borderWidth: 2, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginBottom: 10, backgroundColor: colors.white }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={found.name} uri={found.photoURL} size={44} color={value.color} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
              <Text style={{ fontWeight: '900', fontSize: 16, color: colors.text }} numberOfLines={1}>
                {found.name}
              </Text>
              {!problem && <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{t('newMatch.foundUser')}</Text>}
            </View>
            <Button title={t('newMatch.add')} icon="person-add" onPress={add} disabled={!!problem} testID={`${testID}-add`} />
          </View>
          {/* QA B5: the reason gets its own full-width line and wraps instead of being cut off. */}
          {problem && (
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13, marginTop: 8, flexShrink: 1 }} accessibilityRole="alert" testID={`${testID}-problem`}>
              {problem}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
