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
import { RankCard } from '../../components/RankCard';
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
import { colors, elevation, type } from '../../theme';

function Stat({ icon, label, value, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string | number; testID?: string }) {
  return (
    <View style={{ width: '25%', alignItems: 'center', paddingVertical: 8 }} testID={testID} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={st.statIcon}>
        <Ionicons name={icon} size={20} color={colors.ink} />
      </View>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 6 }}>{value}</Text>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted, textAlign: 'center' }} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/** 76 dp avatar inside a light-blue progress ring (progress to the next rank). */
function RingAvatar({ name, uri, progress }: { name: string; uri?: string | null; progress: number }) {
  const size = 92;
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} testID="profile-ring">
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={5} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.primary} strokeWidth={5} fill="none" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <View style={{ borderRadius: 40, borderWidth: 2, borderColor: colors.white }}>
        <Avatar name={name} uri={uri} size={76} color={colors.white} />
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
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <HeroHeader overlap={64} testID="profile-hero">
          {/* 1.3.8 (V137-14): Edit sits next to the title, so a long name (or Hindi label) never crowds it */}
          <Row>
            <Text style={[type.h1, { color: colors.onInk, flex: 1 }]} accessibilityRole="header">
              {t('profile.title')}
            </Text>
            <PressableScale onPress={() => router.push('/edit-profile')} accessibilityRole="button" accessibilityLabel={t('profile.editProfile')} testID="profile-edit" style={st.edit}>
              <Ionicons name="create-outline" size={16} color={colors.onPrimary} />
              <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: 14 }}>{t('profile.edit')}</Text>
            </PressableScale>
          </Row>
          <Row style={{ marginTop: 12 }}>
            <RingAvatar name={me.name} uri={me.photoURL} progress={ringProgress} />
            <View style={{ marginLeft: 14, flex: 1, gap: 6 }}>
              <Text style={{ color: colors.onInk, fontSize: 22, fontWeight: '800' }} numberOfLines={2}>
                {me.name}
              </Text>
              <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                {pos ? <GlassTag icon="body-outline" text={pos} /> : null}
                {me.city ? <GlassTag icon="location-outline" text={dataLabel(me.city, t)} /> : null}
              </Row>
              <Text style={{ color: colors.onInkMuted, fontSize: 13, fontWeight: '600' }} testID="profile-phone">
                {formatPhone(me.phone)}
              </Text>
            </View>
          </Row>
        </HeroHeader>

        <View style={{ paddingHorizontal: 16, marginTop: -64 }}>
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
                      <View key={f.id} style={[st.form, f.won ? st.formW : st.formL]} testID={`profile-form-${f.won ? 'won' : 'lost'}`}>
                        <Ionicons name={f.won ? 'checkmark' : 'close'} size={18} color={f.won ? colors.white : colors.lossText} />
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden testID="profile-form-legend">
                    <Ionicons name="checkmark" size={12} color={colors.successStrong} />
                    <Text style={st.legend}>{t('profile.formWon')}</Text>
                    <Ionicons name="close" size={12} color={colors.lossText} style={{ marginLeft: 6 }} />
                    <Text style={st.legend}>{t('profile.formLost')}</Text>
                  </View>
                </View>
              ) : null
            }
          />
          <View style={[card, { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 }]} testID="career-stats">
            <Stat icon="calendar-outline" label={t('profile.matches')} value={c ? c.matches : '–'} testID="career-matches" />
            <Stat icon="star-outline" label={t('profile.points')} value={c ? c.points : '–'} testID="career-points" />
            <Stat icon="flash-outline" label={t('profile.spikes')} value={c ? c.kill : '–'} />
            <Stat icon="hand-left-outline" label={t('profile.blocks')} value={c ? c.block : '–'} />
            <Stat icon="trophy-outline" label={t('profile.wins')} value={c ? c.wins : '–'} testID="career-wins" />
            <Stat icon="close-circle-outline" label={t('profile.losses')} value={c ? c.losses : '–'} />
            <Stat icon="pie-chart-outline" label={t('profile.winPct')} value={c?.finished ? Math.round(c.winRate * 100) + '%' : '–'} />
            <Stat icon="tennisball-outline" label={t('profile.aces')} value={c ? c.ace : '–'} />
            {career.notCounted > 0 && (
              <Text style={[type.caption, { color: colors.muted, width: '100%', paddingHorizontal: 10, paddingBottom: 6 }]} testID="career-not-counted">
                {t('profile.notCountedYet', { count: career.notCounted })}
              </Text>
            )}
          </View>

      <SectionHeader title={t('profile.myTeams')} action={`+ ${t('profile.newTeam')}`} onAction={() => router.push('/team/new')} />
      {teams.length === 0 && <Empty icon="people-outline" title={t('profile.noTeam')} text={t('profile.noTeamText')} />}
      {teams.map((tm) => (
        <PressableScale key={tm.id} onPress={() => router.push(`/team/${tm.id}`)} accessibilityRole="button" style={[card, { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }]}>
          <Avatar name={tm.name} size={44} color={tm.color} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
              {tm.name}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {t('profile.players', { count: tm.memberIds.length })}
              {tm.captainId === me.id ? t('profile.captainSuffix') : ''}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </PressableScale>
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
      {/* 1.3.4: demo-only testing tools (demo admin, simulate offline) and About (backend mode + API host) */}
      <View style={{ height: 12 }} />
      <DemoQaTools />
      {/* 1.3.7: feedback (never rewarded), Rate VolleyLive (not live until published), About page */}
      <View style={{ gap: 8 }}>
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

const st = StyleSheet.create({
  statIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  edit: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.primary, alignSelf: 'flex-start', ...elevation.glowPrimary },
  form: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  formW: { backgroundColor: colors.successStrong },
  formL: { backgroundColor: colors.lossBg },
  legend: { fontSize: 11, fontWeight: '700', color: colors.muted },
});
