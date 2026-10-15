import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { GlassTag, HeroHeader, SectionHeader, card } from '../../components/Hero';
import { PressableScale } from '../../components/PressableScale';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { DemoQaTools } from '../../components/AboutCard';
import { openStoreListing } from '../../services/review';
import { MatchCard } from '../../components/MatchCard';
import { PhotoGrid, PhotoViewer } from '../../components/PhotoGallery';
import { Cell, RankCard } from '../../components/RankCard';
import { Body, Display, IconBtn, Sticker, useKit } from '../../components/DNKit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Empty, Row } from '../../components/ui';
import { profileCareer, sideOfPlayer } from '../../core/stats';
import type { Match, MatchPhoto, Team } from '../../core/types';
import { backend } from '../../services/backend';
import { signOut } from '../../services/session';
import { formatPhone } from '../../core/phone';
import { ageFromDob } from '../../core/registration';
import { confirmAsk } from '../../services/dialogs';
import { DemoBackend } from '../../services/backend/demoBackend';
import { useAuth, useMe } from '../../state/AuthContext';
import { placeParts } from '../../core/placeNamesHi';
import { useWatch } from '../../state/hooks';
import { myMatchesKey, useRankings } from '../../state/useRankings';
import { useMemories } from '../../state/useMemories';
import { dataLabel, positionLabel } from '../../i18n/format';
import { colors, elevation, type, themed } from '../../theme';

/** 1.4.22 career stat tile (spec v2 *-05 stats grid, 3 per row). */
function Stat({ label, value, testID, fill, accent }: { label: string; value: string | number; testID?: string; fill?: string; accent?: boolean }) {
  return (
    <View style={{ width: '33.33%' }} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <Cell label={label} value={value} fill={fill} accent={accent} />
    </View>
  );
}

/** 76 dp avatar inside a light-blue progress ring (progress to the next rank). */
function RingAvatar({ name, uri, progress, big }: { name: string; uri?: string | null; progress: number; big?: boolean }) {
  const size = big ? 132 : 92;
  const r = big ? 60 : 42;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="profile-ring">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.primary} strokeWidth={5} fill="none" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <View style={{ borderRadius: 60, borderWidth: 2, borderColor: colors.card }}>
        <Avatar name={name} uri={uri} size={big ? 108 : 76} color={colors.card} />
      </View>
    </View>
  );
}

/** "12 March 2000" (en-IN) / "12 मार्च 2000" (hi-IN); the DOB is a plain YYYY-MM-DD date (no time zone). */
export function formatDob(dob: string, lang: string): string {
  const [y, m, d] = dob.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function privateLabel(me: { dob?: string | null; pincode?: string | null; district?: string | null; state?: string | null }, t: TFunction, lang = 'en') {
  return [t('profile.privateDetails'), me.dob ? t('profile.dobAge', { dob: me.dob, count: ageFromDob(me.dob) ?? 0 }) : null, me.pincode ? [t('profile.pinLine', { pin: me.pincode }), ...placeParts(me.district, me.state, lang)].join(', ') : null].filter(Boolean).join('. ');
}

export default function Profile() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const { isAdmin } = useAuth();
  const k = useKit();
  const insets = useSafeAreaInsets();
  const matches = useWatch<Match[]>((cb) => backend.watchMyMatches(me.id, cb), [me.id]) ?? [];
  const teams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]) ?? [];
  const pos = positionLabel(me.position, t);
  // refetch rankings / memories when one of my matches changes (finished, POTM confirmed, photo added)
  const changeKey = myMatchesKey(matches);
  const rankings = useRankings(me.id, changeKey);
  const memories = useMemories(me.id, changeKey);
  // QA C130-8 (1.3.1): Career stats use the same counted matches as the rank card (and the wallet):
  // before, they counted every finished match while the rank card counted only confirmed ones, so a
  // new player saw "0 matches" on the rank card next to "3 matches" in Career stats.
  const career = profileCareer(me.id, matches, rankings);
  const c = career.stats;
  const [viewer, setViewer] = useState<number | null>(null);
  const titleOf = (p: MatchPhoto) => {
    const m = matches.find((x) => x.id === p.matchId);
    return m ? `${m.teamA.name} – ${m.teamB.name}` : undefined;
  };

  const ahead = rankings?.me?.rank && rankings.me.rank > 1 ? rankings.ranked[rankings.me.rank - 2] : null;
  const ringProgress = rankings?.me?.rank ? (ahead ? rankings.me.rankingPoints / Math.max(1, ahead.rankingPoints) : 1) : (rankings?.me?.matches ?? 0) / Math.max(1, rankings?.minMatches ?? 3);
  // Recent form (W/L chips beside "Career stats") from the same counted matches (C130-8).
  const countedIds = new Set(rankings?.myCountedMatchIds ?? []);
  const form = matches
    .filter((m) => m.status === 'finished' && m.summary.winner && countedIds.has(m.id))
    .slice(0, 3)
    .map((m) => ({ id: m.id, won: sideOfPlayer(m, me.id) === m.summary.winner }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={k.t.statusBar} />
      <ScrollView contentContainerStyle={{ paddingBottom: 104 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* 1.4.22 (spec v2 *-05-profile): Day = "Profile" title + gear, pink identity sticker with Edit profile;
            Night = centred avatar in a Volt progress ring, big name. Gear → Appearance (spec: Settings → Appearance). */}
        <View style={{ paddingHorizontal: 16, paddingTop: insets.top + 10 }} testID="profile-hero">
          <Row>
            <Display size={28} style={{ flex: 1 }} accessibilityRole="header">{k.day ? t('profile.title') : ''}</Display>
            <IconBtn icon="settings-outline" label={t('appearance.title')} onPress={() => router.push('/appearance')} testID="profile-settings" />
          </Row>
          {k.day ? (
            <Sticker fill={k.t.pink} style={{ marginTop: 12 }} testID="profile-identity" inner={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ transform: [{ rotate: '-4deg' }] }}>
                <View style={{ position: 'absolute', left: 3, top: 3, width: 76, height: 76, borderRadius: 20, backgroundColor: k.t.outline }} />
                <View style={{ width: 76, height: 76, borderRadius: 20, backgroundColor: k.t.accent, borderWidth: 2, borderColor: k.t.outline, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} testID="profile-ring">
                  <Avatar name={me.name} uri={me.photoURL} size={72} color={k.t.accent} />
                </View>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Display size={24} numberOfLines={2}>{me.name}</Display>
                <Body bold size={13} numberOfLines={2}>{[pos, me.city ? dataLabel(me.city, t) : null].filter(Boolean).join(' · ')}</Body>
                <Body size={12} testID="profile-phone">{formatPhone(me.phone)}</Body>
                <PressableScale onPress={() => router.push('/edit-profile')} accessibilityRole="button" accessibilityLabel={t('profile.editProfile')} testID="profile-edit"
                  style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: k.t.surface, borderWidth: 2, borderColor: k.t.outline, marginTop: 4 }}>
                  <Ionicons name="create-outline" size={16} color={k.t.text} />
                  <Text style={[{ color: k.t.text, fontSize: 14 }, k.f.bold]}>{t('profile.editProfile')}</Text>
                </PressableScale>
              </View>
            </Sticker>
          ) : (
            <View style={{ alignItems: 'center', marginTop: -20 }} testID="profile-identity">
              <RingAvatar name={me.name} uri={me.photoURL} progress={ringProgress} big />
              <Display size={30} style={{ marginTop: 10, textAlign: 'center' }} numberOfLines={2}>{me.name}</Display>
              <Body muted size={13} style={{ textAlign: 'center' }}>{[pos, me.city ? dataLabel(me.city, t) : null].filter(Boolean).join(' · ')}</Body>
              <Body muted size={12} testID="profile-phone">{formatPhone(me.phone)}</Body>
              <PressableScale onPress={() => router.push('/edit-profile')} accessibilityRole="button" accessibilityLabel={t('profile.editProfile')} testID="profile-edit"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: k.t.surface2, borderWidth: 1, borderColor: k.t.outline, marginTop: 8 }}>
                <Ionicons name="create-outline" size={16} color={k.t.text} />
                <Text style={[{ color: k.t.text, fontSize: 14 }, k.f.bold]}>{t('profile.editProfile')}</Text>
              </PressableScale>
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
          <RankCard rankings={rankings} style={{ marginTop: 0 }} />
          {/* 1.3.0: in-app points wallet (balance only) */}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title={t('wallet.open')} icon="wallet-outline" variant="secondary" onPress={() => router.push('/wallet')} style={{ flex: 1 }} testID="open-wallet" />
          </View>
          {/* 1.3.9 (V138-13): all admin tools in one place, only for admins (isAdmin comes from the backend:
              the demo admin in demo, the server's admin role on the API, the admin claim on Firebase).
              Stacked full-width so the Hindi labels never clip. The screens check admin rights themselves. */}
          {isAdmin ? (
            <View style={[card, { marginTop: 10, gap: 8 }]} testID="profile-admin">
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>{t('profile.adminSection')}</Text>
              <Button title={t('profile.adminReview')} icon="flag-outline" variant="secondary" onPress={() => router.push('/admin-review')} testID="open-admin" />
              <Button title={t('profile.adminFacts')} icon="bulb-outline" variant="secondary" onPress={() => router.push('/admin-daily')} testID="open-admin-facts" />
              <Button title={t('profile.adminFeedback')} icon="chatbox-outline" variant="secondary" onPress={() => router.push('/admin-feedback')} testID="open-admin-feedback-profile" />
            </View>
          ) : null}

          {/* 1.3.7 (R136-19): my own registration details – only on my own Profile tab (other players never get them) */}
          {me.dob || me.pincode ? (
            <View style={[card, { marginTop: 10 }]} testID="profile-private" accessible accessibilityLabel={privateLabel(me, t, i18n.language)}>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{t('profile.privateDetails')}</Text>
              {me.dob ? (
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} testID="profile-dob-age">
                  {t('profile.dobAge', { dob: formatDob(me.dob, i18n.language), count: ageFromDob(me.dob) ?? 0 })}
                </Text>
              ) : null}
              {me.pincode ? (
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 }} testID="profile-pin-district">
                  {t('profile.pinLine', { pin: me.pincode })}
                  {/* 1.4.2 (V141-10): Hindi names only in the Hindi UI (core/placeNamesHi.ts), never a mixed line */}
                  {placeParts(me.district, me.state, i18n.language).length ? ` · ${placeParts(me.district, me.state, i18n.language).join(' · ')}` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}

          <SectionHeader
            title={t('profile.careerStats')}
            right={
              /* 1.4.1 (QA V140-15): ✓ / ✗ marks (icons: no font or language needed – Hindi showed "जी हा हा"), a
                 visible legend, and the whole strip read out as words, latest first */
              form.length ? (
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={t('profile.formLabel', { list: form.map((f) => (f.won ? t('profile.formWon') : t('profile.formLost'))).join(', ') })}
                    testID="profile-form"
                  >
                    {form.map((f) => (
                      <View key={f.id} style={[st.form, { backgroundColor: f.won ? (k.day ? k.t.success : k.t.primary) : k.day ? k.t.surface : k.t.surface2, borderWidth: k.day ? 2 : 0, borderColor: k.t.outline, borderRadius: k.day ? 14 : 8 }]} testID={`profile-form-${f.won ? 'won' : 'lost'}`}>
                        <Ionicons name={f.won ? 'checkmark' : 'close'} size={18} color={f.won ? (k.day ? k.t.text : k.t.onPrimary) : k.t.live} />
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="profile-form-legend">
                    <Ionicons name="checkmark" size={12} color={k.day ? k.t.teamB : k.t.primary} />
                    <Text style={st.legend}>{t('profile.formWon')}</Text>
                    <Ionicons name="close" size={12} color={k.t.live} style={{ marginLeft: 6 }} />
                    <Text style={st.legend}>{t('profile.formLost')}</Text>
                  </View>
                </View>
              ) : null
            }
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }} testID="career-stats">
            <Stat label={t('profile.matches')} value={c ? c.matches : '–'} testID="career-matches" />
            <Stat label={t('profile.points')} value={c ? c.points : '–'} testID="career-points" />
            <Stat label={t('profile.spikes')} value={c ? c.kill : '–'} />
            <Stat label={t('profile.blocks')} value={c ? c.block : '–'} />
            <Stat label={t('profile.wins')} value={c ? c.wins : '–'} testID="career-wins" fill={k.t.success} accent />
            <Stat label={t('profile.losses')} value={c ? c.losses : '–'} />
            <Stat label={t('profile.winPct')} value={c?.finished ? Math.round(c.winRate * 100) + '%' : '–'} fill={k.t.success} />
            <Stat label={t('profile.aces')} value={c ? c.ace : '–'} />
            <Stat label={t('rankings.potm')} value={rankings?.me?.potm ?? '–'} fill={k.t.accent} accent />
            {career.notCounted > 0 && (
              <Text style={[type.caption, { color: k.t.textMuted, width: '100%', paddingHorizontal: 10, paddingBottom: 6 }]} testID="career-not-counted">
                {t('profile.notCountedYet', { count: career.notCounted })}
              </Text>
            )}
          </View>

      <SectionHeader title={t('profile.myTeams')} action={`+ ${t('profile.newTeam')}`} onAction={() => router.push('/team/new')} />
      {teams.length === 0 && <Empty icon="people-outline" title={t('profile.noTeam')} text={t('profile.noTeamText')} />}
      {teams.map((tm) => (
        <Sticker key={tm.id} onPress={() => router.push(`/team/${tm.id}`)} style={{ marginBottom: 10 }} inner={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
          <Avatar name={tm.name} size={44} color={tm.color} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Body bold size={15} numberOfLines={1}>{tm.name}</Body>
            <Text style={[type.caption, { color: k.t.textMuted }]}>
              {t('profile.players', { count: tm.memberIds.length })}
              {tm.captainId === me.id ? t('profile.captainSuffix') : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={k.t.text} />
        </Sticker>
      ))}

      <SectionHeader title={t('profile.memories')} action={memories.length ? t('home.seeAll') : undefined} onAction={() => router.push('/memories')} />
      {memories.length === 0 ? (
        <Empty icon="images-outline" title={t('profile.noMemories')} text={t('profile.noMemoriesText')} />
      ) : (
        <PhotoGrid photos={memories} max={9} onOpen={setViewer} testID="memory" />
      )}
      <PhotoViewer photos={memories} index={viewer} onClose={() => setViewer(null)} nameOf={(uid) => (uid === me.id ? me.name : undefined)} />
      {/* (titleOf is used for the memory captions' accessibility labels) */}

      <SectionHeader title={t('profile.history')} />
      {matches.length === 0 ? <Empty title={t('profile.noMatches')} /> : matches.map((m) => <MatchCard key={m.id} m={m} />)}

      <SectionHeader title={t('profile.settings')} />
      <View style={[card, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        <LanguageSwitch />
      </View>
      {/* 1.4.21 Appearance (Auto / Day / Night) */}
      <View style={{ marginTop: 10 }}>
        <Button title={t('appearance.title')} icon="contrast-outline" variant="secondary" onPress={() => router.push('/appearance')} testID="profile-appearance" />
      </View>
      {/* 1.3.4: demo-only testing tools (demo admin, simulate offline) and About (backend mode + API host) */}
      <View style={{ height: 12 }} />
      <DemoQaTools />
      {/* 1.3.7: feedback (never rewarded), Rate VolleyLive (not live until published), About page */}
      <View style={{ gap: 8 }}>
        <Button title={t('help.open')} icon="help-circle-outline" variant="secondary" onPress={() => router.push('/help')} testID="profile-help" />
        <Button title={t('feedback.open')} icon="chatbox-ellipses-outline" variant="secondary" onPress={() => router.push('/feedback')} testID="profile-feedback" />
        <Button title={t('review.rate')} icon="star-outline" variant="secondary" onPress={() => void openStoreListing()} testID="profile-rate" />
        <Button title={t('aboutPage.open')} icon="information-circle-outline" variant="secondary" onPress={() => router.push('/about')} testID="profile-about" />
      </View>
      <View style={{ height: 12 }} />
      <Button title={t('profile.signOut')} icon="log-out" variant="ghost" onPress={() => void signOut()} />
      {backend instanceof DemoBackend && (
        <Button
          title={t('profile.resetDemo')}
          variant="ghost"
          testID="reset-demo"
          onPress={async () => {
            if (await confirmAsk(t('profile.resetDemoConfirm'))) (backend as DemoBackend).reset();
          }}
        />
      )}
        </View>
      </ScrollView>
    </View>
  );
}

const st = themed(() => StyleSheet.create({
  statIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.primary, alignSelf: 'flex-start', ...elevation.glowPrimary },
  form: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  formW: { backgroundColor: colors.successStrong },
  formL: { backgroundColor: colors.lossBg },
  legend: { fontSize: 11, fontWeight: '700', color: colors.muted },
}));
