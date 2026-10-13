import { Ionicons } from '@expo/vector-icons';
import { toPassText } from '../../components/rankText';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Dimensions, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyCard, GlassButton, HeroHeader, ProgressBar, SectionHeader, Skeleton, card } from '../../components/Hero';
import { LiveMatchCard } from '../../components/MatchCard';
import { DailyCard } from '../../components/DailyCard';
import { reduceMotionNow } from '../../hooks/useReduceMotion';
import { LANGUAGES, currentLanguage, setLanguage } from '../../i18n';
import type { RankingsResult } from '../../services/backend/types';
import { useMyRankings } from '../../state/useRankings';
import { PressableScale } from '../../components/PressableScale';
import { Avatar, Banner, Button, Card, Empty, H2, P, Row, TeamDot } from '../../components/ui';
import type { Challenge, Match, Team } from '../../core/types';
import type { InviteState } from '../../services/backend/types';
import { backend } from '../../services/backend';
import { DEMO_MODE } from '../../services/config';
import { acceptChallenge, getOnce } from '../../services/matchFactory';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { useLocalScores } from '../../services/localScore';
import { formatWhenT as formatWhen, translateError } from '../../i18n/format';
import { notify } from '../../services/dialogs';
import { colors, elevation, font, gradients, overlineFor, type } from '../../theme';


export default function Home() {
  const { t: tr } = useTranslation();
  const me = useMe();
  const myTeams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]) ?? [];
  // An account from before build 216 with a non-Indian number can't receive invites: say so (N4).
  const [inviteState, setInviteState] = useState<InviteState>('ok');
  const invites = useWatch<Team[]>((cb) => backend.watchTeamInvites(me.phone, cb, setInviteState), [me.phone]) ?? [];
  const teamIds = myTeams.map((t) => t.id);
  const challenges = useWatch<Challenge[]>((cb) => backend.watchChallenges(teamIds, cb), [teamIds.join(',')]) ?? [];
  const matches = useLocalScores(useWatch<Match[]>((cb) => backend.watchLiveMatches(cb), [])); // F135-2
  const live = (matches ?? []).filter((m) => m.status === 'live');
  const upcoming = (matches ?? []).filter((m) => m.status === 'scheduled').sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  const incoming = challenges.filter((c) => c.status === 'pending' && c.toCaptainId === me.id);
  const outgoing = challenges.filter((c) => c.status === 'pending' && c.fromCaptainId === me.id);
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (c: Challenge, accept: boolean) => {
    setBusy(c.id);
    try {
      if (!accept) await backend.respondToChallenge(c, 'declined');
      else {
        const to = myTeams.find((t) => t.id === c.toTeamId);
        const from = await getOnce<Team | null>((cb) => backend.watchTeam(c.fromTeamId, cb));
        if (!to || !from) throw new Error('Team not found'); // translated by translateError
        const id = await acceptChallenge(c, me.id, { from, to });
        router.push(`/match/${id}`);
      }
    } catch (e) {
      notify(tr('home.couldNotRespond'), translateError(e));
    } finally {
      setBusy(null);
    }
  };

  const rankings = useMyRankings(me.id); // V1416-2: refetches on my match changes + focus, like Profile
  const scroll = useRef<ScrollView>(null);
  const liveY = useRef(0);
  const insets = useSafeAreaInsets();
  const hour = new Date().getHours();
  const greet = tr(hour < 12 ? 'home.goodMorning' : hour < 17 ? 'home.goodAfternoon' : 'home.goodEvening');
  const lang = currentLanguage();
  const other = LANGUAGES.find((l) => l !== lang) ?? 'en';
  const challenge = () => {
    const captainOf = myTeams.find((t) => t.captainId === me.id);
    if (captainOf) router.push({ pathname: '/challenge/new', params: { fromTeamId: captainOf.id } });
    else notify(tr('home.captainsOnly'), tr('home.captainsOnlyText'));
  };
  // 4×2 quick actions (design-spec §8 01). Every tile has its own destination (Tester 1.2.0: Teams and
  // Photos used to both open the profile).
  const actions: [string, keyof typeof Ionicons.glyphMap, string, () => void][] = [
    ['new-match', 'add', 'home.qaNewMatch', () => router.push('/match/new')],
    ['challenge', 'flash', 'home.qaChallenge', challenge],
    ['live', 'radio', 'home.qaLiveNow', () => scroll.current?.scrollTo({ y: Math.max(0, liveY.current - 8), animated: !reduceMotionNow() })],
    ['tournaments', 'trophy', 'home.qaTournaments', () => router.push('/tournaments')],
    ['rankings', 'podium', 'home.qaRankings', () => router.push('/rankings')],
    ['teams', 'people', 'home.qaMyTeams', () => router.push('/teams')],
    ['nearby', 'location', 'home.qaCourts', () => router.push('/map')],
    ['photos', 'images', 'home.qaMemories', () => router.push('/memories')],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <HeroHeader overlap={56} testID="home-header">
          <Row>
            <Avatar name={me.name} uri={me.photoURL} size={44} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: colors.onInkMuted, fontSize: 13, fontWeight: '600' }}>{greet}</Text>
              <Text style={{ color: colors.onInk, fontSize: 18, fontWeight: '800' }} numberOfLines={1} testID="home-name">
                {me.name}
              </Text>
            </View>
            <GlassButton icon="language" label={tr('language.switchTo', { name: tr(`language.${other}`) })} onPress={() => setLanguage(other)} testID="home-lang" />
          </Row>
        </HeroHeader>

        <View style={{ paddingHorizontal: 16, marginTop: -56 }}>
          <View style={[card, { paddingVertical: 10, paddingHorizontal: 4 }]} testID="quick-actions">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {actions.map(([id, icon, label, go]) => {
                const primary = id === 'new-match';
                return (
                  <PressableScale
                    key={id}
                    testID={`qa-${id}`}
                    accessibilityRole="button"
                    accessibilityLabel={tr(label)}
                    onPress={go}
                    scaleTo={0.92}
                    style={{ width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2 }}
                  >
                    <View style={[s.tile, primary && s.tilePrimary]}>
                      <Ionicons name={primary ? 'add-circle' : icon} size={24} color={colors.ink} />
                    </View>
                    <Text style={s.tileLabel} numberOfLines={2}>
                      {tr(label)}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {DEMO_MODE && <Banner tone="warn" text={tr('home.demoBanner')} />}
          <HomeRankCard rankings={rankings} meId={me.id} />
          <DailyCard />

      {inviteState === 'invalid_phone' && (
        <Banner
          tone="warn"
          text={tr('home.updatePhoneInvites')}
          testID="invites-invalid-phone"
          action={{ label: tr('home.updatePhoneLink'), onPress: () => router.push('/edit-profile'), testID: 'update-phone-link' }}
        />
      )}
      {invites.length > 0 && <H2>{tr('home.teamInvites')}</H2>}
      {invites.map((t) => (
        <Card key={t.id} style={{ borderColor: colors.primaryText, borderWidth: 2 }}>
          <Row>
            <TeamDot color={t.color} size={14} style={{ marginRight: 8 }} />
            <Text style={[font.h3, { flex: 1 }]}>{tr('home.wantsYou', { team: t.name })}</Text>
          </Row>
          <Row style={{ gap: 10, marginTop: 8 }}>
            <Button title={tr('home.joinTeam')} icon="checkmark" style={{ flex: 1 }} onPress={() => backend.acceptTeamInvite(t.id, me.id, me.phone)} />
            <Button title={tr('common.decline')} variant="secondary" style={{ flex: 1 }} onPress={() => backend.declineTeamInvite(t.id, me.phone)} />
          </Row>
        </Card>
      ))}

      {incoming.length > 0 && <H2>{tr('home.challengesForYou')}</H2>}
      {incoming.map((c) => (
        <Card key={c.id} style={{ borderColor: colors.primaryText, borderWidth: 2 }}>
          <Row>
            <Ionicons name="flash" size={20} color={colors.primaryText} />
            <Text style={[font.h3, { marginLeft: 6, flex: 1 }]}>
              {tr('home.challenged', { from: c.fromTeamName, to: c.toTeamName })}
            </Text>
          </Row>
          <P muted style={{ marginTop: 4 }}>
            {formatWhen(c.when)} · {c.location.name}
          </P>
          {c.message ? <P style={{ marginTop: 4, fontStyle: 'italic' }}>“{c.message}”</P> : null}
          <Row style={{ gap: 10, marginTop: 8 }}>
            <Button title={tr('common.accept')} icon="checkmark" style={{ flex: 1 }} loading={busy === c.id} onPress={() => respond(c, true)} />
            <Button title={tr('common.decline')} variant="secondary" style={{ flex: 1 }} onPress={() => respond(c, false)} />
          </Row>
        </Card>
      ))}
      {outgoing.map((c) => (
        <Banner key={c.id} text={tr('home.waiting', { team: c.toTeamName, when: formatWhen(c.when) })} />
      ))}

          <View onLayout={(e) => (liveY.current = e.nativeEvent.layout.y)}>
            <SectionHeader
              title={tr('home.liveNow')}
              right={live.length ? <View style={s.countBadge}><Text style={s.countText}>{live.length}</Text></View> : null}
              action={live.length ? tr('home.seeAll') : undefined}
              onAction={() => router.push('/map')}
            />
          </View>
          {matches === undefined ? (
            <View testID="home-loading" accessibilityLabel={tr('home.loading')}>
              <Skeleton h={150} r={16} />
              <Skeleton h={18} w="40%" style={{ marginTop: 22 }} />
              <Skeleton h={70} r={16} style={{ marginTop: 12 }} />
            </View>
          ) : live.length ? (
            <FlatList
              horizontal
              data={live}
              keyExtractor={(m) => m.id}
              renderItem={({ item }) => <LiveMatchCard m={item} width={live.length === 1 ? cardW : 272} />}
              snapToInterval={284}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6 }}
              testID="live-carousel"
            />
          ) : (
            <EmptyCard icon="radio-outline" title={tr('home.noLiveNearby')} text={tr('home.noLiveNearbyText')} cta={tr('home.startMatch')} onCta={() => router.push('/match/new')} testID="home-no-live" />
          )}

          {matches !== undefined && (
            <>
              <SectionHeader title={tr('home.upcoming')} />
              {upcoming.length ? (
                upcoming.map((m) => <UpcomingRow key={m.id} m={m} />)
              ) : (
                <Empty icon="calendar-outline" title={tr('home.nothingScheduled')} />
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function HomeRankCard({ rankings, meId }: { rankings: RankingsResult | null | undefined; meId: string }) {
  const { t } = useTranslation();
  if (rankings === undefined) return <Skeleton h={92} r={16} style={{ marginTop: 14 }} />;
  if (rankings === null) return null;
  const me = rankings.me;
  const ahead = me?.rank && me.rank > 1 ? rankings.ranked[me.rank - 2] : null;
  const progress = me?.rank ? (ahead ? me.rankingPoints / Math.max(1, ahead.rankingPoints) : 1) : (me?.matches ?? 0) / Math.max(1, rankings.minMatches);
  void meId;
  return (
    <PressableScale onPress={() => router.push('/rankings')} accessibilityRole="button" testID="home-rank" style={{ marginTop: 14 }}>
      <LinearGradient colors={gradients.rankCard as unknown as [string, string]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.rank}>
        <View style={s.rankTile}>
          <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>
            {me?.rank ? `#${me.rank}` : '–'}
          </Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
            {me?.rank ? t('rankings.rankOf', { n: me.rank, total: rankings.total }) : t('rankings.unranked')}
          </Text>
          <Text style={[type.caption, { color: colors.muted, marginTop: 2 }]} numberOfLines={2}>
            {me?.rank
              ? `${t('home.rankPts', { pts: me.rankingPoints })} · ${ahead ? toPassText(t, me.rankingPoints, ahead) : t('home.topRank')}`
              : t('rankings.playMore', { count: Math.max(0, rankings.minMatches - (me?.matches ?? 0)) })}
          </Text>
          <View style={{ marginTop: 8 }}>
            <ProgressBar value={progress} testID="home-rank-progress" />
          </View>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

function UpcomingRow({ m }: { m: Match }) {
  const { t } = useTranslation();
  const d = m.scheduledAt ? new Date(m.scheduledAt) : null;
  const lang = currentLanguage();
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  return (
    <PressableScale onPress={() => router.push(`/match/${m.id}`)} accessibilityRole="button" style={[card, { flexDirection: 'row', alignItems: 'center', marginBottom: 10 }]}>
      <View style={s.date}>
        <Text style={[overlineFor(lang), { color: colors.primaryText }]}>{d ? d.toLocaleString(locale, { month: 'short' }) : '–'}</Text>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{d ? d.getDate() : ''}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[type.h3, { color: colors.text }]} numberOfLines={1}>
          {m.teamA.name} {t('common.vs')} {m.teamB.name}
        </Text>
        <Text style={[type.caption, { color: colors.muted }]} numberOfLines={1}>
          {formatWhen(m.scheduledAt)}
          {m.location ? ` · ${m.location.name}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </PressableScale>
  );
}

const cardW = Math.min(Dimensions.get('window').width - 32, 420);

const s = StyleSheet.create({
  tile: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  tilePrimary: { backgroundColor: colors.primary, ...elevation.glowPrimary },
  tileLabel: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  rank: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.blueLine },
  rankTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  countBadge: { minWidth: 22, height: 20, borderRadius: 6, backgroundColor: colors.live, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  date: { width: 44, height: 48, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
});
