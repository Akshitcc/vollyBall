import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Banner, Button, Empty, Loading, P, Row } from '../../components/ui';
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
import { colors } from '../../theme';
import { Body, Display, Divider, KButton, Over, Sticker, useKit } from '../../components/DNKit';
import { teamRecord } from '../../core/teamRecord';
import type { Match } from '../../core/types';

const confirm = (msg: string) => confirmAsk(msg);

export default function TeamPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const me = useMe();
  const team = useWatch<Team | null>((cb) => backend.watchTeam(id, cb), [id]);
  const profiles = useProfiles(team?.memberIds);
  const k = useKit();
  const myMatches = useWatch<Match[]>((cb) => backend.watchMyMatches(me.id, cb), [me.id]);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const addY = React.useRef(0);
  const phoneRef = React.useRef<import('react-native').TextInput>(null);
  const scrollToAdd = () => phoneRef.current?.focus(); // focusing scrolls the keyboard-aware screen to the field

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

  // 1.4.22 roster row (spec v2 *-03): number badge 40 (team fill), name + captain tag, position; captain actions trailing
  const Member = ({ uid, n, last }: { uid: string; n: number; last?: boolean }) => {
    const p = profiles[uid];
    return (
      <View testID={`team-member-${uid}`}>
        <Row style={{ paddingVertical: 10, paddingHorizontal: 14, minHeight: 64 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: k.day ? k.t.teamA : k.t.surface2, borderWidth: k.day ? 2 : 0, borderColor: k.t.outline, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[{ color: k.day ? k.t.onPrimary : k.t.teamA, fontSize: 17 }, k.f.display]}>{n}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Row style={{ gap: 6 }}>
              <Body bold size={15} numberOfLines={1} style={{ flexShrink: 1 }}>{p?.name ?? t('common.loading')}</Body>
              {uid === team.captainId ? (
                <View testID="captain-tag" style={{ backgroundColor: k.day ? k.t.accent : k.t.primary, borderRadius: 8, borderWidth: k.day ? 1.5 : 0, borderColor: k.t.outline, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={[{ fontSize: 10, color: k.day ? k.t.text : k.t.onPrimary }, k.f.bold]}>{k.day ? t('dn.captainTag').toUpperCase() : 'C'}</Text>
                </View>
              ) : null}
            </Row>
            <Body muted size={12}>{positionLabel(p?.position, t)}</Body>
          </View>
          {isCaptain && uid !== me.id && (
            <>
              <Pressable accessibilityRole="button" onPress={() => toggleSub(uid)} hitSlop={8} style={{ marginRight: 14, minHeight: 44, justifyContent: 'center' }}>
                <Text style={[{ color: k.day ? k.t.teamB : k.t.primary, fontSize: 12 }, k.f.bold]}>{team.subIds.includes(uid) ? t('team.makeStarter') : t('team.makeSub')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('team.removeConfirm', { name: p?.name ?? '' })} onPress={() => remove(uid)} hitSlop={8}>
                <Ionicons name="close-circle" size={22} color={k.t.live} />
              </Pressable>
            </>
          )}
        </Row>
        {!last ? <Divider style={{ marginHorizontal: 14 }} /> : null}
      </View>
    );
  };
  const rec = teamRecord(team.id, myMatches);
  const captainName = profiles[team.captainId]?.name?.split(' ')[0] ?? '';
  const initials = team.name.split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase();
  const stat = (label: string, value: string, fill: string | undefined, id: string) => (
    <View style={{ flex: 1 }} key={id}>
      {k.day ? (
        <Sticker fill={fill} radius={14} shadow={2} testID={`team-stat-${id}`} inner={{ paddingVertical: 8, alignItems: 'center' }}>
          <Text style={[{ fontSize: 22, color: k.t.text, lineHeight: 26 }, k.f.display]}>{value}</Text>
          <Body size={11} bold>{label}</Body>
        </Sticker>
      ) : (
        <View testID={`team-stat-${id}`} style={{ alignItems: 'center' }}>
          <Text style={[{ fontSize: 30, color: id === 'won' ? k.t.primary : k.t.text, lineHeight: 32 }, k.f.display]}>{value}</Text>
          <Body size={11} muted>{label}</Body>
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAwareScreen edges={[]}>
      <Stack.Screen options={{ title: team.name }} />
      {/* 1.4.22 (spec v2 *-03-team): team header card – initials badge, name, city · captain, 4 stats */}
      <Sticker style={{ marginBottom: 14 }} testID="team-header" fill={k.day ? k.t.surface : k.t.surface} inner={{ padding: 16 }}>
        <Row style={{ gap: 12 }}>
          <View style={{ width: 64, height: 64, borderRadius: k.day ? 32 : 18, backgroundColor: k.day ? k.t.accent : k.t.teamA, borderWidth: k.day ? 2 : 0, borderColor: k.t.outline, alignItems: 'center', justifyContent: 'center' }} testID="team-badge">
            <Text style={[{ fontSize: 24, color: k.day ? k.t.text : k.t.onPrimary }, k.f.display]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Display size={24} numberOfLines={2} accessibilityRole="header">{team.name}</Display>
            <Row style={{ gap: 4, marginTop: 2 }}>
              <Ionicons name="location-outline" size={13} color={k.t.textMuted} />
              <Body muted size={12} numberOfLines={1} style={{ flexShrink: 1 }}>{t('dn.cityCaptain', { city: team.city ?? '—', name: captainName })}</Body>
            </Row>
          </View>
        </Row>
        <Row style={{ gap: k.day ? 8 : 4, marginTop: 14 }} testID="team-stats">
          {stat(t('dn.played'), String(rec.played), undefined, 'played')}
          {stat(t('dn.won'), String(rec.won), k.t.success, 'won')}
          {stat(t('dn.lost'), String(rec.lost), undefined, 'lost')}
          {stat(t('dn.winRate'), `${rec.winRate}%`, k.t.accent, 'winrate')}
        </Row>
      </Sticker>
      <Row style={{ gap: 10 }}>
        {isCaptain && (
          <KButton title={t('common.challenge')} icon="flash" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/challenge/new', params: { fromTeamId: team.id } })} testID="team-challenge" />
        )}
        <KButton title={t('dn.startMatch')} icon="play" variant={isCaptain ? 's' : 'p'} style={{ flex: 1 }} onPress={() => router.push({ pathname: '/match/new', params: { teamId: team.id } })} testID="team-new-match" />
      </Row>

      <Row style={{ marginTop: 20, marginBottom: 8 }}>
        <Display size={20} style={{ flex: 1 }} accessibilityRole="header">{t('team.startingSix')}</Display>
        <Body muted size={12}>
          {t('team.summary', { starters: starters.length, size: TEAM_SIZE, subs: subs.length })}
          {team.pendingPhones.length ? t('team.invitedCount', { count: team.pendingPhones.length }) : ''}
        </Body>
      </Row>
      <Sticker testID="team-roster" inner={{ paddingVertical: 4 }}>
        {starters.map((uid, i) => (
          <Member key={uid} uid={uid} n={i + 1} last={i === starters.length - 1 && starters.length >= TEAM_SIZE && !isCaptain} />
        ))}
        {Array.from({ length: Math.max(0, TEAM_SIZE - starters.length) }).map((_, i) => (
          <Row key={i} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: k.t.textMuted }} />
            <Body muted bold style={{ marginLeft: 12 }}>{t('team.openSpot')}</Body>
          </Row>
        ))}
        {isCaptain ? (
          <Pressable accessibilityRole="button" onPress={() => scrollToAdd()} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 52 }} testID="team-add-row">
            <Ionicons name="add-circle" size={22} color={k.day ? k.t.teamB : k.t.primary} />
            <Text style={[{ color: k.day ? k.t.teamB : k.t.primary, fontSize: 14 }, k.f.bold]}>{t('dn.addByMobile')}</Text>
          </Pressable>
        ) : null}
      </Sticker>
      {subs.length > 0 && (
        <>
          <Display size={20} style={{ marginTop: 20, marginBottom: 8 }} accessibilityRole="header">{t('team.substitutes')}</Display>
          <Sticker inner={{ paddingVertical: 4 }}>
            {subs.map((uid, i) => (
              <Member key={uid} uid={uid} n={starters.length + i + 1} last={i === subs.length - 1} />
            ))}
          </Sticker>
        </>
      )}

      {team.pendingPhones.length > 0 && (
        <>
          <Display size={20} style={{ marginTop: 20, marginBottom: 8 }}>{t('team.invited')}</Display>
          <Sticker inner={{ padding: 12 }}>
            {team.pendingPhones.map((p) => (
              <Row key={p} style={{ paddingVertical: 6 }}>
                <Ionicons name="time-outline" size={18} color={k.t.textMuted} />
                <Body bold style={{ flex: 1, marginLeft: 8 }}>{maskPhone(p)}</Body>
                {isCaptain && (
                  <>
                    <Pressable accessibilityRole="button" onPress={() => backend.updateTeam(team.id, { pendingPhones: team.pendingPhones.filter((x) => x !== p) })}>
                      <Ionicons name="trash-outline" size={20} color={k.t.live} />
                    </Pressable>
                  </>
                )}
              </Row>
            ))}
          </Sticker>
        </>
      )}

      {isCaptain && (
        <>
          <View onLayout={(e) => (addY.current = e.nativeEvent.layout.y)} />
          <Display size={20} style={{ marginTop: 20, marginBottom: 8 }}>{t('team.addPlayer')}</Display>
          <PhoneInput ref={phoneRef} digitsOnly label={t('common.mobileNumber')} value={phone} onChangeText={setPhone} hint={t('team.addHint')} testID="team-add-phone" onSubmitEditing={() => isValidMobile(phone) && !full && add()} />
          <KButton title={t('team.addByPhone')} icon="person-add" onPress={add} loading={busy} disabled={full || !isValidMobile(phone)} testID="team-add-button" style={{ marginTop: 8 }} />
          {msg && <Banner tone={msg.tone} text={msg.text} />}
        </>
      )}
      {!isCaptain && <Button title={t('team.leave')} variant="ghost" icon="exit-outline" onPress={leave} />}
      {!isCaptain && <P muted style={{ marginTop: 8, fontSize: 12 }}>{t('team.captainOnly')}</P>}
    </KeyboardAwareScreen>
  );
}
