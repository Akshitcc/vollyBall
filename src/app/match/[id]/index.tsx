/** Match page: real-time scoreboard for followers, stats, timeline, photos. */
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import { formatWhen } from '../../../components/MatchCard';
import MiniCourt from '../../../components/MiniCourt';
import { LiveCameraButton, UploadChip, useAddPhoto } from '../../../components/MatchCamera';
import { PhotoGrid, PhotoViewer } from '../../../components/PhotoGallery';
import { hasCameraButton } from '../../../services/camera';
import { PotmBadge, PotmPicker } from '../../../components/Potm';
import { ResultPanel } from '../../../components/ResultBadge';
import { Avatar, Banner, Button, Card, Chip, Empty, H2, Loading, LiveBadge, P, Row, Screen } from '../../../components/ui';
import { rotationState } from '../../../core/rotation';
import { computeState, timeline, type Side } from '../../../core/scoring';
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
  const add = useAddPhoto(id, me.id);

  const derived = useMemo(() => {
    if (!m) return null;
    const st = computeState(m.rules, m.events, m.firstServe);
    const acc = acceptedEvents(m.rules, m.events, m.firstServe);
    const rot = rotationState(m.rules, m.events, m.firstServe, { A: m.teamA.players.map((p) => p.id), B: m.teamB.players.map((p) => p.id) }, m.lineups);
    return { st, rot, players: playerStats(m.rules, m.events, m.firstServe, m), totals: teamTotals(acc), run: longestRun(acc) };
  }, [m]);

  if (m === undefined) return <Loading />;
  if (m === null || !derived) return <Empty title={tr('match.notFound')} />;
  const { st, rot } = derived;
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
      {/* scoreboard */}
      <LinearGradient colors={gradients.hero as unknown as [string, string, string]} locations={gradients.heroLocations as unknown as [number, number, number]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, marginBottom: 12 }} testID="summary-hero">
        <Row style={{ justifyContent: 'center', marginBottom: 10 }}>
          {m.status === 'live' ? (
            <LiveBadge />
          ) : (
            <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: colors.primary, fontWeight: '800', letterSpacing: letterSpacing(1) }}>{statusLabel(m, tr)}</Text>
            </View>
          )}
        </Row>
        <Row>
          {(['A', 'B'] as Side[]).map((side, i) => {
            const t = side === 'A' ? m.teamA : m.teamB;
            return (
              <React.Fragment key={side}>
                {i === 1 && (
                  <View style={{ alignItems: 'center', paddingHorizontal: 6 }}>
                    <Text style={{ color: colors.white, fontSize: 40, fontWeight: '900' }}>
                      {st.setsWon.A}:{st.setsWon.B}
                    </Text>
                    <Text style={{ color: colors.onInkMuted, fontWeight: '800', fontSize: 11 }}>{tr('common.sets')}</Text>
                  </View>
                )}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ borderRadius: 30, borderWidth: 3, borderColor: colors.white }}>
                    <Avatar name={t.name} size={52} color={t.color} ring />
                  </View>
                  <Text style={{ color: colors.white, fontWeight: '900', fontSize: 16, marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                    {t.name}
                  </Text>
                  {m.status === 'live' && (
                    <Text style={{ color: colors.primary, fontSize: 46, fontWeight: '900' }}>
                      {side === 'A' ? st.current.a : st.current.b}
                      {st.serving === side ? ' 🏐' : ''}
                    </Text>
                  )}
                  {st.winner === side && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }} testID={`winner-${side}`}>
                      <Ionicons name="trophy" size={12} color={colors.ink} />
                      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 12 }}>{tr('match.winner')}</Text>
                    </View>
                  )}
                </View>
              </React.Fragment>
            );
          })}
        </Row>
        {m.status === 'live' && !st.finished && allPlayers.length > 0 && (
          <View testID="follower-court" style={{ marginTop: 12 }}>
            <Row style={{ alignItems: 'flex-start' }}>
              {(['A', 'B'] as Side[]).map((side) => {
                const t = side === 'A' ? m.teamA : m.teamB;
                return (
                  <View key={side} style={{ flex: 1, alignItems: side === 'A' ? 'flex-end' : 'flex-start', paddingHorizontal: 2 }}>
                    {t.players.length > 0 && (
                      <MiniCourt
                        testID={`follower-court-${side}`}
                        positions={rot.positions[side]}
                        names={Object.fromEntries(allPlayers.map((p) => [p.id, p.name]))}
                        server={rot.server}
                        screenSide={side === 'A' ? 'left' : 'right'}
                        teamName={t.name}
                        background={colors.ink}
                      />
                    )}
                  </View>
                );
              })}
            </Row>
            {rot.server && (
              <Text style={{ color: colors.onInkMuted, textAlign: 'center', marginTop: 6, fontSize: 12, fontWeight: '700' }}>
                🏐 {tr('rotation.server', { name: allPlayers.find((p) => p.id === rot.server)?.name ?? '' })}
              </Text>
            )}
          </View>
        )}
        {!!st.sets.length && (
          <Row style={{ justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {st.sets.map((x, i) => (
              <View key={i} style={{ backgroundColor: colors.ink2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, margin: 3 }}>
                <Text style={{ color: colors.white, fontWeight: '800' }}>
                  {tr('match.setShort', { n: i + 1 })} {x.a}-{x.b}
                </Text>
              </View>
            ))}
          </Row>
        )}
        <Text style={{ color: colors.onInkMuted, textAlign: 'center', marginTop: 10, fontSize: 12, fontWeight: '600' }}>{describeRulesT(m.rules, tr)}</Text>
      </LinearGradient>

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
          <LiveCameraButton matchId={m.id} uid={me.id} tone="light" label />
          <UploadChip matchId={m.id} tone="light" />
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

      <Row style={{ marginTop: 10 }}>
        {(['stats', 'timeline', 'photos'] as Tab[]).map((t) => (
          <Chip key={t} label={t === 'photos' ? tr('match.tabPhotos', { count: photos.length }) : t === 'stats' ? tr('match.tabStats') : tr('match.tabTimeline')} active={tab === t} onPress={() => setTab(t)} />
        ))}
      </Row>

      {tab === 'stats' && (
        <>
          <Card>
            <Text style={[font.h3, { marginBottom: 8 }]}>{tr('match.teamStats')}</Text>
            {[
              [tr('match.points'), derived.totals.points.A, derived.totals.points.B],
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
          {canAdd && (
            <>
              <Row style={{ gap: 10 }}>
                <Button title={tr('match.addPhoto')} icon="images" onPress={add.gallery} style={{ flex: 1 }} testID="add-photo-gallery" />
                {hasCameraButton() && (
                  <Button title={tr('match.camera')} icon="camera" variant="dark" onPress={add.camera} style={{ flex: 1 }} testID="add-photo-camera" />
                )}
              </Row>
              <UploadChip matchId={m.id} tone="light" />
              {add.element}
            </>
          )}
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
