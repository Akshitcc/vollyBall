import { HomeGreeting } from '../../components/HomeGreeting';
import { Ionicons } from '@expo/vector-icons';
import { toPassText } from '../../components/rankText';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Dimensions, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyCard, ProgressBar, SectionHeader, Skeleton } from '../../components/Hero';
import { Beam, Blob, Body, Display, GreetArt, Glow, IconBtn, KButton, LivePill, Over, ScoreNum, Sticker, useKit } from '../../components/DNKit';
import { greeting } from '../../theme/resolve';
import { useTheme } from '../../theme/ThemeProvider';
import { dataLabel } from '../../i18n/format';
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
import { colors, elevation, font, gradients, overlineFor, type, themed } from '../../theme';


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

  const k = useKit();
  const { now } = useTheme();
  const rankings = useMyRankings(me.id); // V1416-2: refetches on my match changes + focus, like Profile
  const scroll = useRef<ScrollView>(null);
  const liveY = useRef(0);
  const insets = useSafeAreaInsets();
  const lang = currentLanguage();
  const other = LANGUAGES.find((l) => l !== lang) ?? 'en';
  const challenge = () => {
    const captainOf = myTeams.find((t) => t.captainId === me.id);
    if (captainOf) router.push({ pathname: '/challenge/new', params: { fromTeamId: captainOf.id } });
    else notify(tr('home.captainsOnly'), tr('home.captainsOnlyText'));
  };
  // 4×2 quick actions (design-spec §8 01). Every tile has its own destination (Tester 1.2.0: Teams and
  // Photos used to both open the profile).
  // 1.4.22: the spec's 4 quick actions come first (New match, Challenge, My teams, Rankings); the app's other 4
  // destinations stay as a second row in the same style (the mockup has no room for them, the app still needs them).
  const actions: [string, keyof typeof Ionicons.glyphMap, string, () => void][] = [
    ['new-match', 'add', 'home.qaNewMatch', () => router.push('/match/new')],
    ['challenge', 'flash', 'home.qaChallenge', challenge],
    ['teams', 'people', 'home.qaMyTeams', () => router.push('/teams')],
    ['rankings', 'podium', 'home.qaRankings', () => router.push('/rankings')],
    ['live', 'radio', 'home.qaLiveNow', () => scroll.current?.scrollTo({ y: Math.max(0, liveY.current - 8), animated: !reduceMotionNow() })],
    ['tournaments', 'trophy', 'home.qaTournaments', () => router.push('/tournaments')],
    ['nearby', 'location', 'home.qaCourts', () => router.push('/map')],
    ['photos', 'images', 'home.qaMemories', () => router.push('/memories')],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={k.t.statusBar} />
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 104 + insets.bottom }} keyboardShouldPersistTaps="handled">
        {/* 1.4.22: spec v2 *-01-home – greeting header (art 52, greeting 14, name 26–28, icon button 48), live hero,
            fact sticker, quick actions, upcoming. Day decor: pink blob; Night: violet glow. */}
        {k.day ? <Blob color={k.t.pink} size={190} style={{ top: -70, right: -60 }} /> : <Glow color={k.t.accent} size={260} style={{ top: -90, left: -80 }} />}
        <View style={{ paddingHorizontal: 16, paddingTop: insets.top + 10, flexDirection: 'row', alignItems: 'center', gap: 10 }} testID="home-header">
          <GreetArt kind={greeting(now)} />
          <View style={{ flex: 1 }}>
            <HomeGreeting name={me.name} style={k.day ? { color: k.t.text, fontSize: 14 } : k.f.upper ? { color: k.t.primary, fontSize: 17, lineHeight: 18, letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: k.t.font.display } : { color: k.t.primary, fontSize: 14 }} />
            <Display size={26} numberOfLines={1} testID="home-name">{me.name}</Display>
          </View>
          <IconBtn icon="language" label={tr('language.switchTo', { name: tr(`language.${other}`) })} onPress={() => setLanguage(other)} testID="home-lang" />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          {matches === undefined ? (
            <View testID="home-loading" accessibilityLabel={tr('home.loading')} style={{ marginTop: 14 }}>
              <Skeleton h={190} r={k.t.radius.card} />
            </View>
          ) : live[0] ? (
            <LiveHero m={live[0]} />
          ) : null}
          <DailyCard />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, marginHorizontal: -4 }} testID="quick-actions">
            {actions.map(([id, icon, label, go], i) => (
              <QuickAction key={id} id={id} icon={icon} label={tr(label)} onPress={go} fill={k.day ? [k.t.primary, k.t.success, k.t.pink, k.t.surface][i % 4] : k.t.surface} />
            ))}
          </View>
          {upcoming[0] ? <UpcomingRow m={upcoming[0]} /> : null}

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
              right={live.length ? <View style={[s.countBadge, { backgroundColor: k.t.live }]}><Text style={[s.countText, { color: k.t.onLive }]}>{live.length}</Text></View> : null}
              action={live.length ? tr('home.seeAll') : undefined}
              onAction={() => router.push('/map')}
            />
          </View>
          {matches === undefined ? null : live.length ? (
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
              {upcoming.length ? upcoming.slice(1).map((m) => <UpcomingRow key={m.id} m={m} />) : <Empty icon="calendar-outline" title={tr('home.nothingScheduled')} />}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function HomeRankCard({ rankings, meId }: { rankings: RankingsResult | null | undefined; meId: string }) {
  const { t } = useTranslation();
  const k = useKit();
  if (rankings === undefined) return <Skeleton h={92} r={16} style={{ marginTop: 14 }} />;
  if (rankings === null) return null;
  const me = rankings.me;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ahead = me?.rank && me.rank > 1 ? rankings.ranked[me.rank - 2] : null;
  const progress = me?.rank ? (ahead ? me.rankingPoints / Math.max(1, ahead.rankingPoints) : 1) : (me?.matches ?? 0) / Math.max(1, rankings.minMatches);
  void meId;
  return (
    <Sticker onPress={() => router.push('/rankings')} testID="home-rank" style={{ marginTop: 16 }} inner={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
      <View style={[s.rankTile, { backgroundColor: k.day ? k.t.primary : k.t.surface2, borderColor: k.t.outline, borderWidth: k.day ? 2 : 0 }]}>
        <Text style={[{ color: k.day ? k.t.onPrimary : k.t.primary, fontSize: 20 }, k.f.display]} numberOfLines={1} adjustsFontSizeToFit>
          {me?.rank ? `#${me.rank}` : '–'}
        </Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Body bold size={16} numberOfLines={1}>{me?.rank ? t('rankings.rankOf', { n: me.rank, total: rankings.total }) : t('rankings.unranked')}</Body>
        <Body muted size={12} numberOfLines={2}>
          {me?.rank
            ? `${t('home.rankPts', { pts: me.rankingPoints })} · ${ahead ? toPassText(t, me.rankingPoints, ahead) : t('home.topRank')}`
            : t('rankings.playMore', { count: Math.max(0, rankings.minMatches - (me?.matches ?? 0)) })}
        </Body>
        <View style={{ marginTop: 8 }}>
          <ProgressBar value={progress} testID="home-rank-progress" />
        </View>
      </View>
    </Sticker>
  );
}

function UpcomingRow({ m }: { m: Match }) {
  const { t } = useTranslation();
  const k = useKit();
  const d = m.scheduledAt ? new Date(m.scheduledAt) : null;
  const lang = currentLanguage();
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  return (
    <Sticker onPress={() => router.push(`/match/${m.id}`)} testID={`home-upcoming-${m.id}`} style={{ marginTop: 14 }} inner={{ flexDirection: 'row', alignItems: 'center', padding: 10, paddingHorizontal: 12 }}>
      <View style={[s.date, { backgroundColor: k.day ? k.t.text : k.t.surface2 }]}>
        <Text style={[overlineFor(lang), { color: k.day ? k.t.accent : k.t.primary, fontSize: 10 }]}>{d ? d.toLocaleString(locale, { month: 'short' }) : '–'}</Text>
        <Text style={[{ fontSize: 20, color: k.day ? k.t.surface : k.t.text, lineHeight: 22 }, k.f.display]}>{d ? d.getDate() : ''}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Body bold size={15} numberOfLines={1}>{m.teamA.name} {t('common.vs')} {m.teamB.name}</Body>
        <Body muted size={12} numberOfLines={1}>{formatWhen(m.scheduledAt)}{m.location ? ` · ${m.location.name}` : ''}</Body>
      </View>
      <Ionicons name="chevron-forward" size={18} color={k.t.text} />
    </Sticker>
  );
}

/** Quick action (spec v2 *-01): Day = 60px rounded tile with ink border + hard shadow, coloured fill; Night = surface tile, Volt icon. */
function QuickAction({ id, icon, label, onPress, fill }: { id: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; fill: string }) {
  const k = useKit();
  return (
    <PressableScale testID={`qa-${id}`} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} scaleTo={0.92}
      style={{ width: '25%', alignItems: 'center', paddingHorizontal: 4, paddingBottom: k.day ? 12 : 8 }}>
      {k.day ? (
        <Sticker fill={fill} radius={20} shadow={3} inner={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={26} color={k.t.text} />
        </Sticker>
      ) : (
        <View style={{ width: '100%', minHeight: 76, borderRadius: 18, backgroundColor: k.t.surface, borderWidth: 1, borderColor: k.t.surface2, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 2, paddingVertical: 6 }}>
          <Ionicons name={id === 'new-match' ? 'add-circle' : icon} size={24} color={k.t.primary} />
          <Text style={[{ fontSize: 12, lineHeight: 16, color: k.t.text, textAlign: 'center' }, k.f.bold]} numberOfLines={2}>{label}</Text>
        </View>
      )}
      {k.day ? <Text style={[{ marginTop: 6, fontSize: 12, lineHeight: 16, color: k.t.text, textAlign: 'center' }, k.f.bold]} numberOfLines={2}>{label}</Text> : null}
    </PressableScale>
  );
}

/** Live hero (spec v2 *-01): LIVE badge + title/set, team names, score stickers (Day) / neon numerals (Night), sets, Watch live. */
function LiveHero({ m }: { m: Match }) {
  const { t } = useTranslation();
  const k = useKit();
  const s0 = m.summary;
  const setNo = s0.setScores.length + 1;
  const title = `${dataLabel(m.title, t) || `${m.teamA.name} ${t('common.vs')} ${m.teamB.name}`} · ${t('home.setN', { n: setNo })}`;
  const fg = k.day ? k.t.onPrimary : k.t.text;
  const inner = (
    <View style={{ padding: 16, paddingTop: 14 }}>
      {!k.day ? <Beam color={k.t.primary} width={220} height={260} style={{ top: -10, left: '50%', marginLeft: -110 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LivePill text={t('common.live')} />
        <Body bold size={12} color={fg} style={{ flex: 1 }} numberOfLines={1}>{title}</Body>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {!k.day ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.t.teamA }} /> : null}
          <Body bold size={13} color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>{m.teamA.name}</Body>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
          <Body bold size={13} color={fg} numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{m.teamB.name}</Body>
          {!k.day ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: k.t.teamB }} /> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }} testID="live-hero-score">
        <ScoreNum value={s0.currentA} color={k.t.teamA} tilt={-3} accessibilityLabel={`${m.teamA.name} ${s0.currentA}`} />
        <View style={{ alignItems: 'center' }}>
          {k.day ? (
            <Sticker radius={12} shadow={2} inner={{ paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center' }}>
              <Over color={k.t.text} style={{ fontSize: 10 }}>{t('common.sets')}</Over>
              <Text style={[{ color: k.t.text, fontSize: 16 }, k.f.display]}>{s0.setsA}–{s0.setsB}</Text>
            </Sticker>
          ) : (
            <>
              <Over>{t('common.sets')}</Over>
              <Text style={[{ color: k.t.text, fontSize: 26, lineHeight: 28 }, k.f.display]}>{s0.setsA}–{s0.setsB}</Text>
            </>
          )}
        </View>
        <ScoreNum value={s0.currentB} color={k.t.teamB} tilt={3} accessibilityLabel={`${m.teamB.name} ${s0.currentB}`} />
      </View>
      <KButton title={t('score.watchLive')} icon="play" variant={k.day ? 's' : 's'} onPress={() => router.push(`/match/${m.id}`)} testID="live-hero-watch" style={{ marginTop: 14 }} />
    </View>
  );
  if (k.day) return <Sticker fill={k.t.hero[0]} style={{ marginTop: 14 }} testID="live-hero">{inner}</Sticker>;
  return (
    <View testID="live-hero" style={{ marginTop: 14, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: k.t.outline }}>
      <LinearGradient colors={k.t.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {inner}
    </View>
  );
}

const cardW = Math.min(Dimensions.get('window').width - 32, 420);

const s = themed(() => StyleSheet.create({
  tile: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  tilePrimary: { backgroundColor: colors.primary, ...elevation.glowPrimary },
  tileLabel: { marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.text, textAlign: 'center' },
  rank: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.blueLine },
  rankTile: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  countBadge: { minWidth: 22, height: 20, borderRadius: 6, backgroundColor: colors.live, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  date: { width: 44, height: 48, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
}));
