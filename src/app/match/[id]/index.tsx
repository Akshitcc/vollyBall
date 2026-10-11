/** Match page: real-time scoreboard for followers, stats, timeline, photos. */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { formatWhen } from '../../../components/MatchCard';
import { CourtCard, RallyTicker } from '../../../components/LiveScoring';
import { LiveScoreboard, PulsingLive } from '../../../components/ViewerParts';
import { AddPhotoButtons } from '../../../components/PhotoSheet';
import { PhotoGrid, PhotoViewer } from '../../../components/PhotoGallery';
import { PotmBadge, PotmPicker } from '../../../components/Potm';
import { ResultPanel } from '../../../components/ResultBadge';
import { Avatar, Banner, Button, Card, Chip, Empty, H2, Loading, LiveBadge, P, Row, Screen } from '../../../components/ui';
import { rotationState } from '../../../core/rotation';
import { computeState, timeline, type MatchEvent, type Side } from '../../../core/scoring';
import { acceptedEvents, creditLabel, KIND_EMOJI, longestRun, playerStats, teamTotals } from '../../../core/stats';
import type { Match, MatchPhoto } from '../../../core/types';
import { backend } from '../../../services/backend';
import { useAuth, useMe } from '../../../state/AuthContext';
import { useWatch } from '../../../state/hooks';
import { useProfiles } from '../../../state/profiles';
import { canAddMatchPhoto } from '../../../core/photos';
import { dataLabel, describeRulesT, letterSpacing, matchStatusLabel, shareTextT as shareText } from '../../../i18n/format';
import { colors, font, gradients, teamText } from '../../../theme';

type Tab = 'stats' | 'timeline' | 'photos';

export default function MatchPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr } = useTranslation();
  const me = useMe();
  const { isAdmin } = useAuth();
  const m = useWatch<Match | null>((cb) => backend.watchMatch(id, cb), [id]);
  const photos = useWatch<MatchPhoto[]>((cb) => backend.watchPhotos(id, cb), [id]) ?? [];
  const [tab, setTab] = useState<Tab>('stats');
  const [viewer, setViewer] = useState<number | null>(null);
  const interested = useProfiles(m?.interestedIds);
  const uploaders = useProfiles(useMemo(() => [...new Set(photos.map((p) => p.uploadedBy))], [photos]));

  const derived = useMemo(() => {
    if (!m) return null;
    const st = computeState(m.rules, m.events, m.firstServe);
    const acc = acceptedEvents(m.rules, m.events, m.firstServe);
    const rot = rotationState(m.rules, m.events, m.firstServe, { A: m.teamA.players.map((p) => p.id), B: m.teamB.players.map((p) => p.id) }, m.lineups);
    return { st, rot, players: playerStats(m.rules, m.events, m.firstServe, m), totals: teamTotals(acc), run: longestRun(acc), tl: timeline(m.rules, m.events, m.firstServe) };
  }, [m]);

  if (m === undefined) return <Loading />;
  if (m === null || !derived) return <Empty title={tr('match.notFound')} />;
  const { st, rot } = derived;
  const live = m.status === 'live' && !st.finished;
  const setsNeeded = Math.ceil((m.rules.bestOf ?? 1) / 2);
  const pointCounts = Object.fromEntries(Object.entries(derived.players).map(([pid, l]) => [pid, l.points]));
  const playerName = (pid?: string) => (pid ? [...m.teamA.players, ...m.teamB.players].find((p) => p.id === pid)?.name : undefined);
  const rallyText = (e: MatchEvent) =>
    e.type === 'timeout'
      ? tr('match.timeoutFor', { team: e.side === 'A' ? m.teamA.name : m.teamB.name })
      : [e.playerId ? (playerName(e.playerId) ?? tr('common.player')).split(' ')[0] : e.side === 'A' ? m.teamA.name : m.teamB.name, e.playerId ? null : tr('liveV2.teamPoint'), e.kind ? tr(`kinds.${e.kind}`) : null].filter(Boolean).join(' · ');
  const pts = m.events.filter((e): e is Extract<MatchEvent, { type: 'point' }> => e.type === 'point');
  const lastPt = pts[pts.length - 1];
  const tickerText = lastPt ? rallyText(lastPt) : '';
  const dots = pts.slice(-4).map((e) => (e.side === 'A' ? m.teamA.color : m.teamB.color));
  // 1.3.3: team points (scoreboard panel taps, legacy uncredited rallies) – never credited to a player
  const teamOnly = { A: 0, B: 0 };
  for (const e of acceptedEvents(m.rules, m.events, m.firstServe)) if (e.type === 'point' && !e.playerId) teamOnly[e.side]++;
  const recent = derived.tl.slice(-2).reverse();
  const ago = (at: number) => {
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    return sec < 10 ? tr('liveV2.justNow') : sec < 60 ? tr('liveV2.secondsAgo', { n: sec }) : tr('liveV2.minutesAgo', { n: Math.round(sec / 60) });
  };
  const isScorer = m.scorerId === me.id;
  const isCreator = m.createdBy === me.id;
  const isParticipant = m.participantIds.includes(me.id);
  const nameOf = (side: Side) => (side === 'A' ? m.teamA.name : m.teamB.name);
  const allPlayers = [...m.teamA.players.map((p) => ({ ...p, side: 'A' as Side })), ...m.teamB.players.map((p) => ({ ...p, side: 'B' as Side }))];

  // Players of the match and its scorer can add photos (server, firestore.rules and storage.rules agree).
  const canAdd = canAddMatchPhoto(m, me.id);
  // PRD PHOTO-03: the uploader deletes their own photo (the server and rules allow the uploader only).
  const mine = (p: MatchPhoto) => p.uploadedBy === me.id;
  const deletePhoto = (p: MatchPhoto) => backend.deleteMatchPhoto(p);
  const nameOfUser = (uid: string) => allPlayers.find((p) => p.id === uid)?.name ?? uploaders[uid]?.name;

  const share = () =>
    Share.share({ message: shareText(m.teamA.name, m.teamB.name, m.rules, m.events, m.firstServe, { location: m.location?.name }) });

  const wantToPlay = async () => {
    const ids = new Set(m.interestedIds ?? []);
    if (ids.has(me.id)) ids.delete(me.id);
    else ids.add(me.id);
    await backend.updateMatch(m.id, { interestedIds: [...ids] });
  };

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: dataLabel(m.title, tr) || tr('titles.match') }} />
      {/* scoreboard (1.3.2, design 11 v2 viewer): big current-set scores, set count, serving pill */}
      <LinearGradient colors={gradients.hero as unknown as [string, string, string]} locations={gradients.heroLocations as unknown as [number, number, number]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={hs.hero} testID="summary-hero">
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={hs.setHead} numberOfLines={1} testID="viewer-set-head">
            {live
              ? `${tr('score.setHeader', { n: st.setIndex + 1 })}${st.isDecidingSet ? tr('score.decider') : ''}${tr('score.toPoints', { n: st.targetPoints })}`
              : statusLabel(m, tr)}
          </Text>
          {m.status === 'live' ? <PulsingLive /> : null}
        </Row>
        <LiveScoreboard teamA={m.teamA} teamB={m.teamB} st={st} setsNeeded={setsNeeded} live={live} />
        {(['A', 'B'] as Side[]).map((side) =>
          st.winner === side ? (
            <View key={side} style={[hs.winner, { alignSelf: side === 'A' ? 'flex-start' : 'flex-end' }]} testID={`winner-${side}`}>
              <Ionicons name="trophy" size={12} color={colors.ink} />
              <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 12 }} numberOfLines={1}>
                {tr('match.winner')} · {side === 'A' ? m.teamA.name : m.teamB.name}
              </Text>
            </View>
          ) : null,
        )}
        <Text style={{ color: colors.onInkMuted, textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: '600' }}>{describeRulesT(m.rules, tr)}</Text>
      </LinearGradient>

      {live && lastPt && (
        <View style={{ marginHorizontal: -12 }} testID="viewer-ticker">
          <RallyTicker text={`${tr('liveV2.lastRally')}: ${tickerText}`} dots={dots} />
        </View>
      )}
      {/* readable lineup: who is on court where, the server, and each player's points */}
      {live && allPlayers.length > 0 && (
        <View testID="follower-court" style={{ marginHorizontal: -12 }}>
          <CourtCard
            left={{ side: 'A', name: m.teamA.name, color: m.teamA.color, positions: rot.positions.A }}
            right={{ side: 'B', name: m.teamB.name, color: m.teamB.color, positions: rot.positions.B }}
            names={Object.fromEntries(allPlayers.map((p) => [p.id, p.name]))}
            server={rot.server}
            points={pointCounts}
            testID="viewer-court"
          />
          {rot.server && (
            <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 6, fontSize: 12, fontWeight: '700' }} testID="viewer-server">
              🏐 {tr('rotation.server', { name: allPlayers.find((p) => p.id === rot.server)?.name ?? '' })}
            </Text>
          )}
        </View>
      )}
      {live && recent.length > 0 && (
        <Card style={{ marginTop: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={hs.recentHead}>{tr('liveV2.recentRallies')}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{tr('liveV2.autoUpdating')}</Text>
          </Row>
          <View testID="recent-rallies">
            {recent.map((e, k) => (
              <Row key={k} style={{ paddingVertical: 6, borderTopWidth: k ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={[hs.dot, { backgroundColor: e.event.side === 'A' ? m.teamA.color : m.teamB.color, marginRight: 8 }]} />
                <Text style={{ flex: 1, fontWeight: '700', color: colors.text }} numberOfLines={1}>
                  {rallyText(e.event)}
                </Text>
                <Text style={{ fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'], marginRight: 10 }}>
                  {e.a}–{e.b}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12, width: 44, textAlign: 'right' }}>{ago(e.event.at)}</Text>
              </Row>
            ))}
          </View>
        </Card>
      )}

      {m.location && (
        <Pressable
          onPress={() =>
            Linking.openURL(
              Platform.select({
                ios: `http://maps.apple.com/?ll=${m.location!.lat},${m.location!.lng}&q=${encodeURIComponent(m.location!.name)}`,
                default: `https://www.google.com/maps/search/?api=1&query=${m.location!.lat},${m.location!.lng}`,
              }),
            )
          }
        >
          <Row style={{ marginBottom: 8 }}>
            <Ionicons name="location" size={18} color={colors.primaryText} />
            <Text style={[font.body, { marginLeft: 6, flex: 1, fontWeight: '700' }]}>{m.location.name}</Text>
            <Text style={{ color: colors.primaryText, fontWeight: '800' }}>{tr('match.directions')}</Text>
          </Row>
        </Pressable>
      )}
      {m.scheduledAt && m.status === 'scheduled' && <P muted style={{ marginBottom: 8 }}>🗓 {formatWhen(m.scheduledAt)}</P>}

      {isScorer && m.status !== 'finished' && m.status !== 'abandoned' && (
        <Button title={m.status === 'scheduled' ? tr('common.startScoring') : tr('common.continueScoring')} icon="play" big onPress={() => router.push(`/match/${m.id}/score`)} />
      )}
      {!isScorer && m.status === 'live' && <Banner text={tr('match.followingBanner')} />}
      {/* live camera for the players and the scorer: photo straight into this match's Photos */}
      {m.status === 'live' && canAdd && (
        <View style={{ marginBottom: 8 }} testID="live-camera-row">
          <AddPhotoButtons matchId={m.id} uid={me.id} testIDPrefix="live-photo" />
        </View>
      )}
      {m.status === 'finished' && (m.playerOfMatchId ? <PotmBadge match={m} /> : isScorer && <PotmPicker match={m} uid={me.id} />)}
      {/* 1.3.0: result state, the opposing captain's confirmation and admin review */}
      {m.status === 'finished' && <ResultPanel match={m} meId={me.id} isAdmin={isAdmin} nameOf={(uid) => (uid === me.id ? me.name : allPlayers.find((p) => p.id === uid)?.name)} />}
      <Row style={{ gap: 10 }}>
        <Button title={tr('common.share')} icon="share-social" variant="secondary" onPress={share} style={{ flex: 1 }} />
        {m.status === 'scheduled' && !isParticipant && (
          <Button
            title={(m.interestedIds ?? []).includes(me.id) ? tr('match.imIn') : tr('match.wantToPlay')}
            icon="hand-left"
            variant="dark"
            onPress={wantToPlay}
            style={{ flex: 1 }}
          />
        )}
      </Row>

      {/* Live video placeholder – architecture ready (Match.stream), not built yet */}
      {m.status === 'live' && (
        <Card style={{ backgroundColor: colors.surface }}>
          <Row>
            <Ionicons name="videocam-off-outline" size={20} color={colors.muted} />
            <Text style={[font.small, { color: colors.muted, marginLeft: 8, flex: 1 }]}>{tr('match.videoSoon')}</Text>
          </Row>
        </Card>
      )}

      {/* Handing over scoring only makes sense while the match can still be scored. */}
      {isCreator && m.status !== 'finished' && m.status !== 'abandoned' && (
        <View testID="scorer-picker">
          <Card>
            <Text style={[font.h3, { marginBottom: 6 }]}>{tr('match.scorer')}</Text>
            <P muted style={{ marginBottom: 8 }}>{tr('match.scorerHint')}</P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {[{ id: me.id, name: tr('common.me') }, ...allPlayers.filter((p) => p.id !== me.id)].map((p) => (
                <Chip key={p.id} label={p.name.split(' ')[0]} active={m.scorerId === p.id} onPress={() => backend.updateMatch(m.id, { scorerId: p.id })} />
              ))}
            </View>
          </Card>
        </View>
      )}

      {Object.keys(interested).length > 0 && (
        <Card>
          <Text style={[font.h3, { marginBottom: 6 }]}>{tr('match.wantToPlayCount', { count: Object.keys(interested).length })}</Text>
          {Object.values(interested).map((p) => (
            <Row key={p.id} style={{ marginVertical: 3 }}>
              <Avatar name={p.name} uri={p.photoURL} size={28} />
              <Text style={{ marginLeft: 8, fontWeight: '700' }}>{p.name}</Text>
            </Row>
          ))}
        </Card>
      )}

      {/* summary: the match's photos at a glance (all of them in the Photos tab) */}
      {/* finished matches: add photos straight from the summary too */}
      {m.status === 'finished' && canAdd && tab !== 'photos' && (
        <View style={{ marginBottom: 8 }} testID="finished-photo-row">
          <AddPhotoButtons matchId={m.id} uid={me.id} testIDPrefix="finished-photo" />
        </View>
      )}
      {m.status === 'finished' && photos.length > 0 && tab !== 'photos' && (
        <Card>
          <Row style={{ marginBottom: 8 }}>
            <Text style={[font.h3, { flex: 1 }]}>{tr('photos.matchPhotos')}</Text>
            <Pressable onPress={() => setTab('photos')} testID="summary-photos-all" hitSlop={8} accessibilityRole="button">
              <Text style={{ color: colors.primaryText, fontWeight: '800' }}>{tr('photos.seeAll', { count: photos.length })}</Text>
            </Pressable>
          </Row>
          <PhotoGrid photos={photos} max={6} onOpen={setViewer} testID="summary-photo" />
        </Card>
      )}

      <View style={hs.tabs} accessibilityRole="tablist" testID="match-tabs">
        {(['stats', 'timeline', 'photos'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            style={[hs.tab, tab === t && hs.tabOn]}
            testID={`match-tab-${t}`}
          >
            <Text style={[hs.tabText, tab === t && hs.tabTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {t === 'photos' ? tr('match.tabPhotos', { count: photos.length }) : t === 'stats' ? tr('match.tabStats') : tr('match.tabTimeline')}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'stats' && (
        <>
          <Card>
            <Text style={[font.h3, { marginBottom: 8 }]}>{tr('match.teamStats')}</Text>
            {[
              [tr('match.points'), derived.totals.points.A, derived.totals.points.B],
              // 1.3.2: team-only points ("+1 · Opp. error" – no player credit, never toward POTM)
              [tr('liveV2.teamPointsNoPlayer'), teamOnly.A, teamOnly.B],
              [tr('match.spikes'), derived.totals.byKind.A.kill, derived.totals.byKind.B.kill],
              [tr('match.blocks'), derived.totals.byKind.A.block, derived.totals.byKind.B.block],
              [tr('match.aces'), derived.totals.byKind.A.ace, derived.totals.byKind.B.ace],
              [tr('match.tips'), derived.totals.byKind.A.tip, derived.totals.byKind.B.tip],
              [tr('match.longestRun'), derived.run.A, derived.run.B],
            ].map(([label, a, b]) => (
              <Row key={label as string} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ width: 50, fontWeight: '900', fontSize: 19, color: teamText(m.teamA.color) }}>{a}</Text>
                <Text style={{ flex: 1, textAlign: 'center', fontWeight: '700', color: colors.muted }}>{label}</Text>
                <Text style={{ width: 50, fontWeight: '900', fontSize: 19, textAlign: 'right', color: teamText(m.teamB.color) }}>{b}</Text>
              </Row>
            ))}
          </Card>
          <Card>
            <Text style={[font.h3, { marginBottom: 8 }]}>{tr('match.playerPoints')}</Text>
            {allPlayers.length === 0 && <P muted>{tr('match.noPlayers')}</P>}
            {allPlayers
              .map((p) => ({ p, line: derived.players[p.id] }))
              .sort((x, y) => (y.line?.points ?? 0) - (x.line?.points ?? 0))
              .map(({ p, line }) => (
                <Row key={p.id} style={{ paddingVertical: 6 }}>
                  <Avatar name={p.name} uri={p.photoURL} size={32} color={p.side === 'A' ? m.teamA.color : m.teamB.color} />
                  <Text style={{ flex: 1, marginLeft: 8, fontWeight: '700' }} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={{ color: colors.muted, fontWeight: '700', marginRight: 10, fontSize: 12 }}>
                    {line ? `${line.kill}${KIND_EMOJI.kill} ${line.block}${KIND_EMOJI.block} ${line.ace}${KIND_EMOJI.ace} ${line.tip}${KIND_EMOJI.tip}` : '—'}
                  </Text>
                  <Text style={{ fontWeight: '900', fontSize: 17, width: 30, textAlign: 'right' }}>{line?.points ?? 0}</Text>
                </Row>
              ))}
          </Card>
        </>
      )}

      {tab === 'timeline' && <Timeline m={m} nameOf={nameOf} />}

      {tab === 'photos' && (
        <View testID="photos-tab">
          {/* 1.3.2: Choose from gallery (multi-select, up to 10) next to Camera (phones only); live and finished matches */}
          {canAdd && <AddPhotoButtons matchId={m.id} uid={me.id} />}
          {photos.length === 0 ? (
            <Empty icon="images-outline" title={tr('match.noPhotos')} text={tr('match.noPhotosText')} />
          ) : (
            <View style={{ marginTop: 8 }}>
              <PhotoGrid photos={photos} onOpen={setViewer} testID="photo-thumb" canDelete={mine} onDelete={deletePhoto} />
            </View>
          )}
        </View>
      )}
      <PhotoViewer photos={photos} index={viewer} onClose={() => setViewer(null)} nameOf={nameOfUser} canDelete={mine} onDelete={deletePhoto} />
    </Screen>
  );
}

function Timeline({ m, nameOf }: { m: Match; nameOf: (s: Side) => string }) {
  const { t, i18n } = useTranslation();
  const tl = useMemo(() => timeline(m.rules, m.events, m.firstServe).reverse(), [m]);
  const names = new Map([...m.teamA.players, ...m.teamB.players].map((p) => [p.id, p.name]));
  if (!tl.length) return <Empty icon="list-outline" title={t('match.noPoints')} />;
  return (
    <Card>
      {tl.slice(0, 300).map((e, i) => (
        <Row key={i} style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
          <Text style={{ width: i18n.language === 'hi' ? 44 : 34, color: colors.muted, fontWeight: '800', fontSize: 12 }}>{t('match.setShort', { n: e.set })}</Text>
          <Text style={{ width: 64, fontWeight: '900', fontSize: 15 }}>
            {e.a}-{e.b}
          </Text>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: e.event.side === 'A' ? m.teamA.color : m.teamB.color, marginRight: 8 }} />
          <Text style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
            {e.event.type === 'timeout'
              ? t('match.timeoutFor', { team: nameOf(e.event.side) })
              : e.event.playerId
                ? creditLabel(names.get(e.event.playerId) ?? t('common.player'), e.event.kind) // no 💥 without a shot type
                : nameOf(e.event.side)}
          </Text>
        </Row>
      ))}
    </Card>
  );
}

function statusLabel(m: Match, t: TFunction) {
  return matchStatusLabel(m.status, t);
}

const hs = StyleSheet.create({
  hero: { borderRadius: 22, paddingHorizontal: 14, paddingVertical: 16, marginBottom: 12 },
  setHead: { color: colors.white, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  center: { alignItems: 'center', paddingHorizontal: 4, minWidth: 76, paddingTop: 6 },
  overline: { color: colors.onInkMuted, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  setsBig: { color: colors.white, fontSize: 32, lineHeight: 38, fontWeight: '900', fontVariant: ['tabular-nums'] },
  setPill: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  setPillText: { color: colors.white, fontWeight: '800', fontSize: 12, fontVariant: ['tabular-nums'] },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.white, marginRight: 6 },
  dotServing: { borderColor: colors.primary },
  teamName: { color: colors.white, fontWeight: '800', fontSize: 15, textAlign: 'center', flexShrink: 1 },
  pip: { width: 18, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  winner: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  recentHead: { color: colors.muted, fontWeight: '800', fontSize: 12, letterSpacing: 1, marginBottom: 4 },
  tabs: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 14, padding: 4, marginTop: 12, marginBottom: 4, borderWidth: 1, borderColor: colors.hairline },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 6 },
  tabOn: { backgroundColor: colors.ink },
  tabText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  tabTextOn: { color: colors.white, fontWeight: '800' },
});
