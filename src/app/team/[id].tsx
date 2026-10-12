import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Avatar, Banner, Button, Card, Empty, Field, H2, Loading, P, Row } from '../../components/ui';
import { isValidMobile, maskPhone, toE164 } from '../../core/phone';
import { PhoneInput } from '../../components/PhoneInput';
import { MAX_SUBS, TEAM_SIZE, type Team } from '../../core/types';
import { backend } from '../../services/backend';
import { confirmAsk } from '../../services/dialogs';
import { goBackOr } from '../../services/nav';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { useProfiles } from '../../state/profiles';
import { positionLabel, translateError } from '../../i18n/format';
import { colors, font, onColor } from '../../theme';

const confirm = (msg: string) => confirmAsk(msg);

export default function TeamPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const me = useMe();
  const team = useWatch<Team | null>((cb) => backend.watchTeam(id, cb), [id]);
  const profiles = useProfiles(team?.memberIds);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);

  if (team === undefined) return <Loading />;
  if (team === null) return <Empty title={t('team.notFound')} />;
  const isCaptain = team.captainId === me.id;
  const starters = team.memberIds.filter((m) => !team.subIds.includes(m));
  const subs = team.subIds.filter((m) => team.memberIds.includes(m));
  const full = team.memberIds.length + team.pendingPhones.length >= TEAM_SIZE + MAX_SUBS;

  const add = async () => {
    setMsg(null);
    const n = toE164(phone);
    if (!n) return setMsg({ tone: 'warn', text: t('team.invalidPhone') });
    if (team.pendingPhones.includes(n)) return setMsg({ tone: 'warn', text: t('team.alreadyInvited') });
    if (full) return setMsg({ tone: 'warn', text: t('team.full', { size: TEAM_SIZE, subs: MAX_SUBS }) });
    setBusy(true);
    try {
      const user = await backend.findUserByPhone(n);
      // Only players who have already registered themselves can be added.
      if (!user) {
        setMsg({ tone: 'warn', text: t('team.notRegistered') });
        return;
      }
      if (team.memberIds.includes(user.id)) {
        setMsg({ tone: 'warn', text: t('team.alreadyInTeam', { name: user.name }) });
        return;
      }
      await backend.updateTeam(team.id, { pendingPhones: [...team.pendingPhones, n] });
      setPhone('');
      setMsg({ tone: 'info', text: t('team.inviteSent', { name: user.name }) });
    } catch (e) {
      setMsg({ tone: 'warn', text: translateError(e) });
    } finally {
      setBusy(false);
    }
  };

  const toggleSub = (uid: string) => {
    const isSub = team.subIds.includes(uid);
    if (!isSub && team.subIds.length >= MAX_SUBS) return;
    if (isSub && starters.length >= TEAM_SIZE) return setMsg({ tone: 'warn', text: t('team.tooManyStarters', { size: TEAM_SIZE }) });
    backend.updateTeam(team.id, { subIds: isSub ? team.subIds.filter((x) => x !== uid) : [...team.subIds, uid] });
  };

  const remove = async (uid: string) => {
    if (!(await confirm(t('team.removeConfirm', { name: profiles[uid]?.name ?? t('team.thisPlayer') })))) return;
    backend.updateTeam(team.id, { memberIds: team.memberIds.filter((x) => x !== uid), subIds: team.subIds.filter((x) => x !== uid) });
  };

  const leave = async () => {
    if (!(await confirm(t('team.leaveConfirm')))) return;
    await backend.updateTeam(team.id, { memberIds: team.memberIds.filter((x) => x !== me.id), subIds: team.subIds.filter((x) => x !== me.id) });
    goBackOr('/profile');
  };

  const Member = ({ uid }: { uid: string }) => {
    const p = profiles[uid];
    return (
      <Row style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <Avatar name={p?.name ?? '…'} uri={p?.photoURL} size={40} color={team.color} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={{ fontWeight: '800', fontSize: 15 }}>
            {p?.name ?? t('common.loading')} {uid === team.captainId ? '©' : ''}
          </Text>
          <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 12 }}>{positionLabel(p?.position, t)}</Text>
        </View>
        {isCaptain && uid !== me.id && (
          <>
            <Pressable accessibilityRole="button" onPress={() => toggleSub(uid)} hitSlop={8} style={{ marginRight: 14 }}>
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 12 }}>{team.subIds.includes(uid) ? t('team.makeStarter') : t('team.makeSub')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => remove(uid)} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color={colors.danger} />
            </Pressable>
          </>
        )}
      </Row>
    );
  };

  return (
    <KeyboardAwareScreen edges={[]}>
      <Stack.Screen options={{ title: team.name }} />
      <View style={{ backgroundColor: team.color, borderRadius: 18, padding: 18, marginBottom: 12 }}>
        <Text style={[font.h1, { color: onColor(team.color) }]} numberOfLines={2}>{team.name}</Text>
        <Text style={{ color: onColor(team.color), fontWeight: '700', marginTop: 4 }}>
          {t('team.summary', { starters: starters.length, size: TEAM_SIZE, subs: subs.length })}
          {team.pendingPhones.length ? t('team.invitedCount', { count: team.pendingPhones.length }) : ''}
        </Text>
      </View>
      <Row style={{ gap: 10 }}>
        <Button title={t('common.newMatch')} icon="play" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/match/new', params: { teamId: team.id } })} />
        {isCaptain && (
          <Button title={t('common.challenge')} icon="flash" variant="dark" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/challenge/new', params: { fromTeamId: team.id } })} />
        )}
      </Row>

      <H2>{t('team.startingSix')}</H2>
      <Card>
        {starters.map((uid) => (
          <Member key={uid} uid={uid} />
        ))}
        {Array.from({ length: Math.max(0, TEAM_SIZE - starters.length) }).map((_, i) => (
          <Row key={i} style={{ paddingVertical: 10 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border }} />
            <Text style={{ marginLeft: 10, color: colors.muted, fontWeight: '700' }}>{t('team.openSpot')}</Text>
          </Row>
        ))}
      </Card>
      {subs.length > 0 && (
        <>
          <H2>{t('team.substitutes')}</H2>
          <Card>
            {subs.map((uid) => (
              <Member key={uid} uid={uid} />
            ))}
          </Card>
        </>
      )}

      {team.pendingPhones.length > 0 && (
        <>
          <H2>{t('team.invited')}</H2>
          <Card>
            {team.pendingPhones.map((p) => (
              <Row key={p} style={{ paddingVertical: 6 }}>
                <Ionicons name="time-outline" size={18} color={colors.muted} />
                <Text style={{ flex: 1, marginLeft: 8, fontWeight: '700' }}>{maskPhone(p)}</Text>
                {isCaptain && (
                  <>
                    <Pressable accessibilityRole="button" onPress={() => backend.updateTeam(team.id, { pendingPhones: team.pendingPhones.filter((x) => x !== p) })}>
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  </>
                )}
              </Row>
            ))}
          </Card>
        </>
      )}

      {isCaptain && (
        <>
          <H2>{t('team.addPlayer')}</H2>
          <PhoneInput digitsOnly label={t('common.mobileNumber')} value={phone} onChangeText={setPhone} hint={t('team.addHint')} testID="team-add-phone" onSubmitEditing={() => isValidMobile(phone) && !full && add()} />
          <Button title={t('team.addByPhone')} icon="person-add" onPress={add} loading={busy} disabled={full || !isValidMobile(phone)} testID="team-add-button" />
          {msg && <Banner tone={msg.tone} text={msg.text} />}
        </>
      )}
      {!isCaptain && <Button title={t('team.leave')} variant="ghost" icon="exit-outline" onPress={leave} />}
      {!isCaptain && <P muted style={{ marginTop: 8, fontSize: 12 }}>{t('team.captainOnly')}</P>}
    </KeyboardAwareScreen>
  );
}
