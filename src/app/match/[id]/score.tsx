/**
 * LIVE SCORING SCREEN – the heart of the app.
 *
 * Two big halves, one per team. Tap the half of the team that won the rally.
 * Everything else (serve, set/match wins, deciding set, side switches) is
 * automatic. Undo reverses the last action. After each point an optional
 * player row lets the scorer credit the point (kill/block/ace/tip).
 *
 * Rotation: when players are named, the court card below the halves shows who stands
 * in positions 1–6 (derived from the event log, so undo reverses rotations).
 * Before the first rally of a set the scorer can set the starting lineup.
 *
 * Offline: every change is saved to the device first (AsyncStorage) and then
 * pushed to the backend; Firestore queues writes while offline and the full
 * event log is re-sent on reconnect, so nothing is lost.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CourtCard, RallyTicker, TeamHalf, TeamPointButton, type ChipOrigin } from '../../../components/LiveScoring';
import { FlyingPoint, LiveScoreboard, type Flight } from '../../../components/ViewerParts';
import { PhotoHeaderButton } from '../../../components/PhotoSheet';
import { CHIP_DEBOUNCE_MS, TEAM_HALF_TAP } from '../../../core/liveFlags';
import { firstName } from '../../../components/MiniCourt';
import { useReduceMotion } from '../../../hooks/useReduceMotion';
import { haptic } from '../../../services/haptics';
import LineupPicker from '../../../components/LineupPicker';
import { LiveCameraButton, UploadChip } from '../../../components/MatchCamera';
import { PotmPicker } from '../../../components/Potm';
import { Avatar, Button, Loading, P } from '../../../components/ui';
import { rotationState, startingLineup, type SideLineups } from '../../../core/rotation';
import {
  POINT_KINDS,
  addPoint,
  attributePoint,
  playerPoint,
  callTimeout,
  computeState,
  summarize,
  undo,
  type MatchEvent,
  type PointKind,
  type Side,
} from '../../../core/scoring';
import { playerPointCounts } from '../../../core/stats';
import { canStartScoring, isUserId, MIN_PLAYERS, orderedParticipants } from '../../../core/roster';
import type { Match, Team } from '../../../core/types';
import { getOnce, matchTeamFromTeam } from '../../../services/matchFactory';
import { backend } from '../../../services/backend';
import { confirmAsk, notify } from '../../../services/dialogs';
import { goBackOr } from '../../../services/nav';
import { useMe } from '../../../state/AuthContext';
import { letterSpacing, shareTextT as shareText, translateError } from '../../../i18n/format';
import { colors, elevation, palette } from '../../../theme';

const cacheKey = (id: string) => `score-cache-${id}`;

type SyncState = 'synced' | 'saving' | 'offline' | 'error';

export default function ScoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr, i18n } = useTranslation();
  const me = useMe();
  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [events, setEvents] = useState<MatchEvent[] | null>(null);
  const [swapped, setSwapped] = useState(false);
  // The rally being credited: its team and its index in the event log (captured at tap time).
  const [attrib, setAttrib] = useState<{ side: Side; index: number } | null>(null);
  const [sync, setSync] = useState<SyncState>('synced');
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const pushSeq = useRef(0);
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live match v2: last chip tap (debounce), the flying "+1" and the score targets it flies to.
  const lastChip = useRef<{ id: string; at: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const scoreRefA = useRef<View>(null);
  const scoreRefB = useRef<View>(null);

  // Load match once; prefer a newer local copy (unsynced offline points).
  useEffect(() => {
    let first = true;
    return backend.watchMatch(id, async (m) => {
      setMatch(m);
      if (!first || !m) return;
      first = false;
      let ev = m.events;
      try {
        const raw = await AsyncStorage.getItem(cacheKey(id));
        if (raw) {
          const cached = JSON.parse(raw) as { events: MatchEvent[]; savedAt: number; pending: boolean };
          if (cached.pending && cached.savedAt > m.updatedAt) ev = cached.events;
        }
      } catch {
        // ignore cache errors
      }
      setEvents(ev);
    });
  }, [id]);

  const push = useCallback(
    async (m: Match, ev: MatchEvent[]) => {
      const seq = ++pushSeq.current;
      const st = computeState(m.rules, ev, m.firstServe);
      const status: Match['status'] = st.finished ? 'finished' : 'live';
      await AsyncStorage.setItem(cacheKey(m.id), JSON.stringify({ events: ev, savedAt: Date.now(), pending: true })).catch(() => {});
      setSync('saving');
      if (retryTimer.current) clearTimeout(retryTimer.current);
      // If the write hangs (offline), show "offline" – Firestore keeps it queued.
      const slow = setTimeout(() => seq === pushSeq.current && setSync('offline'), 4000);
      try {
        await backend.saveMatchProgress(m.id, {
          events: ev,
          summary: summarize(st),
          status,
          // 1.3.0: start/finish times come from the backend's clock (server time), never the device.
          // Once the Player of the Match is picked the match is closed (no undo), so a POTM is never
          // left on a re-opened match (QA retest 1.2.1 INFO).
        });
        if (seq === pushSeq.current) {
          setSync('synced');
          setError(null);
          await AsyncStorage.setItem(cacheKey(m.id), JSON.stringify({ events: ev, savedAt: Date.now(), pending: false })).catch(() => {});
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (seq !== pushSeq.current) return;
        if (/permission|scorer/i.test(msg)) {
          setSync('error');
          setError(i18n.t('score.onlyScorerError'));
        } else {
          setSync('offline');
          retryTimer.current = setTimeout(() => push(m, ev), 5000); // retry with the latest log
        }
      } finally {
        clearTimeout(slow);
      }
    },
    [],
  );

  if (match === undefined || (match && events === null)) return <Loading />;
  if (match === null)
    return (
      <SafeAreaView style={{ flex: 1, padding: 24 }}>
        <P>{tr('score.notFound')}</P>
        <Button title={tr('common.back')} onPress={() => goBackOr('/')} />
      </SafeAreaView>
    );
  if (match.scorerId !== me.id)
    return (
      <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <P style={{ textAlign: 'center', marginBottom: 12 }}>{tr('score.notScorer')}</P>
        <Button title={tr('score.watchLive')} onPress={() => router.replace(`/match/${match.id}`)} />
      </SafeAreaView>
    );

  // Every team needs MIN_PLAYERS registered players before the first rally (core/roster.ts).
  if (!canStartScoring(match) && !(events ?? []).length) return <NeedPlayers match={match} onUpdated={setMatch} />;

  const ev = events ?? [];
  const st = computeState(match.rules, ev, match.firstServe);
  const rosterIds = { A: match.teamA.players.map((p) => p.id), B: match.teamB.players.map((p) => p.id) };
  const rot = rotationState(match.rules, ev, match.firstServe, rosterIds, match.lineups);
  const hasPlayers = rosterIds.A.length > 0 || rosterIds.B.length > 0;
  const canSetLineup = hasPlayers && rot.atSetStart && !st.finished;
  const names: Record<string, string> = Object.fromEntries([...match.teamA.players, ...match.teamB.players].map((p) => [p.id, p.name]));

  const saveLineup = (l: SideLineups) => {
    const lineups = { ...(match.lineups ?? {}), [String(rot.setIndex + 1)]: l };
    setMatch({ ...match, lineups });
    setLineupOpen(false);
    backend.updateMatch(match.id, { lineups }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const commit = (next: MatchEvent[], msg?: string) => {
    const before = computeState(match.rules, ev, match.firstServe);
    const after = computeState(match.rules, next, match.firstServe);
    setEvents(next);
    push(match, next);
    if (after.finished && !before.finished) {
      haptic('success');
    } else if (after.sets.length > before.sets.length) {
      const s = after.sets[after.sets.length - 1];
      flash(tr('score.setTo', { n: after.sets.length, team: s.winner === 'A' ? match.teamA.name : match.teamB.name, a: s.a, b: s.b }));
      haptic('success');
    } else if (!TEAM_HALF_TAP && after.setPoint && !before.setPoint) {
      haptic('warning'); // §11.4: set point / match point banner + warning
      if (after.sideSwitchDue) flash(tr('score.switchSides'));
      else if (msg) flash(msg);
    } else if (after.sideSwitchDue) {
      flash(tr('score.switchSides'));
    } else if (msg) flash(msg);
  };

  /** ⋮ → Abandon: always confirmed (translated, every platform) and a failed save is reported. */
  const abandon = async () => {
    if (abandoning || !match) return;
    setMenu(false);
    // iOS won't show an alert while the menu modal is still animating away.
    if (Platform.OS === 'ios') await new Promise((r) => setTimeout(r, 400));
    const ok = await confirmAsk(tr('score.abandonConfirm'), { title: tr('score.abandon'), confirmLabel: tr('score.abandonYes'), cancelLabel: tr('score.abandonKeep'), returnFocusTo: 'score-menu' });
    if (!ok) return;
    setAbandoning(true);
    try {
      await backend.updateMatch(match.id, { status: 'abandoned' });
      setAbandoning(false);
      router.replace(`/match/${match.id}`);
    } catch (e) {
      setAbandoning(false);
      notify(tr('score.abandonFailed'), translateError(e));
    }
  };

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 2500);
  };

  const tap = (side: Side) => {
    if (st.finished) return;
    haptic('point');
    const next = addPoint(match.rules, ev, side, { firstServe: match.firstServe });
    commit(next);
    const roster = side === 'A' ? match.teamA.players : match.teamB.players;
    // Offered for the match-winning rally too (the result dialog waits until it is credited or skipped).
    setAttrib(roster.length ? { side, index: next.length - 1 } : null);
  };

  /**
   * 1.3.2: tap a player on the court = ONE event giving that player and their team the point (only
   * on-court players of the roster; the scorer check is on every backend). Undo drops the event, so
   * both the player's and the team's point go back. Rotation/serve follow from the event log.
   */
  const tapPlayer = (side: Side, playerId: string, origin?: ChipOrigin) => {
    if (st.finished) return;
    // §11.3: a second tap on the SAME chip within 250 ms is ignored; taps on other chips always count.
    const now = Date.now();
    if (lastChip.current && lastChip.current.id === playerId && now - lastChip.current.at < CHIP_DEBOUNCE_MS) return;
    lastChip.current = { id: playerId, at: now };
    const next = playerPoint(match.rules, ev, side, playerId, { roster: rosterIds[side], onCourt: rot.positions[side], firstServe: match.firstServe });
    if (next.length === ev.length) return;
    haptic('point');
    setAttrib(null); // already credited: no "Who scored?" sheet
    commit(next);
    if (!reduceMotion && origin) {
      const target = (side === 'A' ? scoreRefA : scoreRefB).current;
      Promise.all([origin(), new Promise<{ x: number; y: number } | null>((res) => {
        const tm = setTimeout(() => res(null), 120);
        try {
          target?.measureInWindow?.((x, y, w, h) => { clearTimeout(tm); res(w || h ? { x: x + w / 2, y: y + h / 2 } : null); });
        } catch { clearTimeout(tm); res(null); }
      })]).then(([from, to]) => from && to && setFlight({ from, to, key: now }));
    }
  };

  /** "+1 · Opp. error": a team point with no player credit (never toward POTM). Light haptic. */
  const teamPoint = (side: Side) => {
    if (st.finished) return;
    haptic('undo');
    setAttrib(null);
    commit(addPoint(match.rules, ev, side, { firstServe: match.firstServe }));
  };

  // Tapping a player credits the rally to them straight away; the shot type is an optional extra.
  // (QA retest: picking a player and then moving on without a shot type used to leave the point
  // silently uncredited.)
  const credit = (playerId: string, kind?: PointKind) => {
    if (!attrib) return;
    // Credit exactly the tapped rally (a timeout in between no longer drops it) and only to a player of the team that won it.
    const roster = (attrib.side === 'A' ? match.teamA : match.teamB).players.map((p) => p.id);
    haptic('select');
    commit(attributePoint(ev, attrib.index, playerId, kind, roster));
    if (kind) setAttrib(null);
  };

  // completed (finished + Player of the Match): closed for good, no undo (core/antifraud.ts isTerminal)
  const closed = match?.status === 'finished' && !!match.playerOfMatchId;
  const doUndo = () => {
    if (!ev.length || closed) return;
    haptic('undo');
    setAttrib(null);
    commit(undo(ev), tr('score.undone'));
  };

  const timeout = (side: Side) => {
    if (st.timeoutsLeft[side] <= 0) return flash(tr('score.noTimeouts'));
    commit(callTimeout(match.rules, ev, side, { firstServe: match.firstServe }), tr('score.timeoutFor', { team: side === 'A' ? match.teamA.name : match.teamB.name }));
  };

  // Devanagari's headline (शिरोरेखा) breaks apart with extra letter spacing, so it is dropped in Hindi.
  const ls1 = { letterSpacing: letterSpacing(1) };
  const left: Side = swapped ? 'B' : 'A';
  const right: Side = swapped ? 'A' : 'B';
  const teamOf = (side: Side) => (side === 'A' ? match.teamA : match.teamB);
  const compact = !!attrib;
  // 288 dp halves on a 800 dp phone (design-spec), smaller on short screens.
  // 1.3.2: with players the court tiles are the main scoring buttons, so the halves (team point /
  // opponent error) get shorter to keep the court on screen.
  const halfH = hasPlayers ? Math.max(150, Math.min(210, Math.round(winH * 0.25))) : Math.max(200, Math.min(288, Math.round(winH * 0.36)));
  const setsToWin = Math.ceil((match.rules.bestOf ?? 1) / 2);

  const half = (side: Side) => {
    const t = teamOf(side);
    return (
      <TeamHalf
        key={side}
        side={side}
        name={t.name}
        color={t.color}
        score={side === 'A' ? st.current.a : st.current.b}
        setsWon={side === 'A' ? st.setsWon.A : st.setsWon.B}
        setsToWin={setsToWin}
        serving={st.serving === side && !st.finished}
        point={st.setPoint === side && !st.finished ? (st.matchPoint === side ? 'match' : 'set') : null}
        timeoutsLeft={st.timeoutsLeft[side]}
        compact={compact}
        showHint={ev.length === 0}
        onPoint={() => tap(side)}
        onTimeout={() => timeout(side)}
        height={compact ? Math.round(halfH * 0.78) : halfH}
      />
    );
  };

  // Undo shows the score it goes back to (screen order), e.g. "Back to 18–17" (design-spec §8).
  const undoTo = ev.length ? computeState(match.rules, undo(ev), match.firstServe).current : null;
  // QA C130-4: once the Player of the Match is set the match is closed, so Undo looks disabled and says why.
  const canUndo = ev.length > 0 && !closed;
  const lastEv = ev[ev.length - 1];
  const backTo = undoTo ? tr('score.backTo', { score: left === 'A' ? `${undoTo.a}–${undoTo.b}` : `${undoTo.b}–${undoTo.a}` }) : null;
  // "Aarav −1 · back to 18–17": undoing a tapped point takes it back from the player too.
  const undoSub = closed
    ? tr('score.undoClosed')
    : backTo
      ? lastEv?.type === 'point'
        ? lastEv.playerId && names[lastEv.playerId]
          ? `${tr('liveV2.undoPlayer', { name: firstName(names[lastEv.playerId]) })} · ${backTo}`
          : `${tr('liveV2.undoTeam', { team: teamOf(lastEv.side).name.split(/\s+/)[0] })} · ${backTo}`
        : backTo
      : tr('score.nothingToUndo');

  // Last rally ticker: who scored, how, and the current run; the last 4 rallies as dots.
  const points = ev.filter((e): e is Extract<MatchEvent, { type: 'point' }> => e.type === 'point');
  const lastPt = points[points.length - 1];
  let run = 0;
  for (let i = points.length - 1; i >= 0 && lastPt && points[i].side === lastPt.side; i--) run++;
  const tickerText = lastPt
    ? [lastPt.playerId ? firstName(names[lastPt.playerId]) : teamOf(lastPt.side).name, lastPt.kind ? tr(`kinds.${lastPt.kind}`) : null, run >= 2 ? tr('score.runOf', { n: run }) : null]
        .filter(Boolean)
        .join(' · ')
    : tr('score.noRallies');
  const dots = points.slice(-4).map((e) => teamOf(e.side).color);

  const attribTeam = attrib ? teamOf(attrib.side) : null;
  const creditedEv = attrib ? ev[attrib.index] : undefined;
  const credited = creditedEv?.type === 'point' && creditedEv.playerId ? creditedEv.playerId : null;
  // On-court players first in the sheet (then the bench).
  const sheetPlayers = attrib && attribTeam
    ? [...attribTeam.players.filter((p) => isUserId(p.id))].sort((a, b) => Number(!rot.positions[attrib.side].includes(b.id)) - Number(!rot.positions[attrib.side].includes(a.id)) || 0)
    : [];

  return (
    // 1.3.2: no bottom edge here – the action bar / sheet add the gesture inset themselves (min 16 dp, §11.1)
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={[]}>
      {/* navy header: close · SET n · TO 25 + sync · LIVE camera · menu; set strip below */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <View style={s.top}>
          <Pressable onPress={() => goBackOr(`/match/${match.id}`)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('common.close')} style={s.iconBtn}>
            <Ionicons name="close" size={26} color={colors.white} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[s.topTitle, ls1]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {st.finished
                ? tr('score.matchOver')
                : `${tr('score.setHeader', { n: st.setIndex + 1 })}${st.isDecidingSet ? tr('score.decider') : ''}${tr('score.toPoints', { n: st.targetPoints })}`}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Ionicons name={sync === 'synced' ? 'cloud-done' : sync === 'saving' ? 'cloud-upload-outline' : 'cloud-offline'} size={14} color={sync === 'synced' ? palette.syncIcon : colors.onInkMuted} />
              <Text style={s.topSub} numberOfLines={1} testID="sync-label">
                {syncLabel(sync, tr)}
              </Text>
            </View>
            {/* live photo upload progress: inside the header, never over the score or "Who scored" */}
            <UploadChip matchId={match.id} />
          </View>
          {TEAM_HALF_TAP ? <LiveCameraButton matchId={match.id} uid={me.id} pill /> : <PhotoHeaderButton matchId={match.id} uid={me.id} onOpenPhotos={() => router.replace(`/match/${match.id}`)} />}
          {/* 44 px target: hitSlop does nothing on web, so the bare 24 px icon was easy to miss (QA retest) */}
          <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('score.options')} testID="score-menu" style={s.iconBtn}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.white} />
          </Pressable>
        </View>
        {!TEAM_HALF_TAP && (
          <View style={{ paddingHorizontal: 8, paddingTop: 6 }}>
            <LiveScoreboard teamA={match.teamA} teamB={match.teamB} st={st} setsNeeded={setsToWin} live left={left} scoreRefs={{ A: scoreRefA, B: scoreRefB }} />
          </View>
        )}
        {!TEAM_HALF_TAP && st.setPoint && !st.finished && (
          <View style={s.pointBanner} testID="point-banner">
            <Text style={s.pointBannerText} numberOfLines={1}>
              {`${tr(st.matchPoint ? 'score.matchPoint' : 'score.setPoint')} · ${teamOf(st.setPoint).name}`}
            </Text>
          </View>
        )}
        {TEAM_HALF_TAP && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.setStrip} testID="set-strip">
          {/* finished sets in screen order (left team first), so the strip matches the halves after a swap */}
          {st.sets.map((x, i) => (
            <View key={i} style={s.setPill}>
              <Text style={s.setPillText}>{`S${i + 1}  ${left === 'A' ? `${x.a}–${x.b}` : `${x.b}–${x.a}`}`}</Text>
            </View>
          ))}
          {!st.finished && (
            <View style={[s.setPill, s.setPillNow]}>
              <Ionicons name="time-outline" size={13} color={colors.onPrimary} />
              <Text style={[s.setPillText, { color: colors.onPrimary }]}>{st.sets.length ? `S${st.setIndex + 1}` : tr('score.firstSet')}</Text>
            </View>
          )}
        </ScrollView>}
      </View>
      {error && <Text style={s.error}>{error}</Text>}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled" scrollEnabled={!compact}>
        {canSetLineup && (
          <Pressable testID="open-lineup" onPress={() => setLineupOpen(true)} style={s.lineupBar}>
            <Ionicons name="people" size={16} color={colors.onPrimary} />
            <Text style={s.lineupBarText} numberOfLines={1}>
              {tr('rotation.setLineup', { n: rot.setIndex + 1 })}
            </Text>
          </Pressable>
        )}
        {/* v1 (TEAM_HALF_TAP): the two halves, each whole half is the tap target */}
        {TEAM_HALF_TAP && (
          <View style={s.halves}>
            {half(left)}
            {half(right)}
          </View>
        )}
        {!compact && <RallyTicker text={lastPt ? `${tr('liveV2.lastRally')}: ${tickerText}` : tickerText} dots={dots} onPress={() => router.replace(`/match/${match.id}`)} />}
        {!compact && hasPlayers && (
          <>
            <CourtCard
              left={{ side: left, name: teamOf(left).name, color: teamOf(left).color, positions: rot.positions[left] }}
              right={{ side: right, name: teamOf(right).name, color: teamOf(right).color, positions: rot.positions[right] }}
              names={names}
              server={st.finished ? null : rot.server}
              points={playerPointCounts(match.rules, ev, match.firstServe, match)}
              onPlayer={tapPlayer}
              disabled={st.finished}
              onSub={() => (canSetLineup ? setLineupOpen(true) : flash(tr('rotation.onlyAtSetStart')))}
            />
            {TEAM_HALF_TAP && <Text style={s.oppHint} testID="opp-error-hint">{tr('score.oppErrorHint')}</Text>}
          </>
        )}
        {/* v2: team-only points for opponent errors (no player credit) */}
        {!TEAM_HALF_TAP && (
          <View style={s.teamBtns} testID="team-point-row">
            {[left, right].map((side) => (
              <TeamPointButton key={side} side={side} name={teamOf(side).name} color={teamOf(side).color} disabled={st.finished} onPress={() => teamPoint(side)} />
            ))}
          </View>
        )}
      </ScrollView>

      {!reduceMotion && <FlyingPoint flight={flight} onDone={() => setFlight(null)} />}
      {toast && (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      {/* "Who scored?" sheet: slides up below the halves, which stay tappable (next point = skip) */}
      {attribTeam && (
        <Animated.View entering={reduceMotion ? undefined : SlideInDown.duration(280)} style={[s.sheet, { paddingBottom: Math.max(16, insets.bottom) }]} testID="who-scored">
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={s.attribTitle} numberOfLines={2}>
              {tr('score.whoScored', { team: attribTeam.name })}
            </Text>
            <Pressable onPress={() => setAttrib(null)} hitSlop={10} testID="attrib-skip" style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text style={s.skip}>{tr(credited ? 'score.done' : 'score.skip')}</Text>
            </Pressable>
          </View>
          {/* keyed by rally so a player picked for one rally can't carry over to the next (other team's) rally */}
          <AttributionRow key={attrib!.index} players={sheetPlayers} color={attribTeam.color} onPick={credit} onDone={() => setAttrib(null)} />
        </Animated.View>
      )}

      {/* bottom bar: Undo (with the score it reverts to) · Swap · Stats */}
      {!attribTeam && (
        <View style={[s.bottom, { paddingTop: 10, paddingBottom: Math.max(16, insets.bottom) }]} testID="score-bottom-bar">
          <Pressable
            onPress={doUndo}
            style={({ pressed }) => [s.undo, !canUndo ? s.undoDisabled : elevation.glowPrimary, pressed && canUndo ? { opacity: 0.85 } : null]}
            disabled={!canUndo}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canUndo }}
            accessibilityLabel={`${tr('score.undo')}. ${undoSub}`}
            testID="undo"
          >
            <Ionicons name="arrow-undo" size={24} color={canUndo ? colors.onPrimary : colors.disabledText} />
            <View style={{ flexShrink: 1 }}>
              <Text style={[s.undoText, ls1, { color: canUndo ? colors.onPrimary : colors.disabledText }]} numberOfLines={1}>
                {tr('score.undo')}
              </Text>
              <Text style={[s.undoSub, { color: canUndo ? colors.onPrimary : colors.disabledText }]} numberOfLines={closed ? 2 : 1} testID="undo-sub">
                {undoSub}
              </Text>
            </View>
          </Pressable>
          <Pressable onPress={() => setSwapped((x) => !x)} style={s.tile} accessibilityRole="button" testID="swap">
            <Ionicons name="swap-horizontal" size={22} color={colors.ink} />
            <Text style={[s.tileText, ls1]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {tr('score.swap')}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.replace(`/match/${match.id}`)} style={s.tile} accessibilityRole="button" testID="stats">
            <Ionicons name="stats-chart" size={20} color={colors.ink} />
            <Text style={[s.tileText, ls1]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {tr('score.stats')}
            </Text>
          </Pressable>
        </View>
      )}

      {/* match over */}
      <Modal visible={st.finished && !attrib} transparent animationType="fade">
        <View style={s.modalBg}>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <View style={s.modal} testID="match-over">
            <Text style={{ fontSize: 36, textAlign: 'center' }}>🏆</Text>
            <Text style={s.winner}>{tr('score.teamWins', { team: st.winner === 'A' ? match.teamA.name : match.teamB.name })}</Text>
            <Text style={s.final}>
              {st.setsWon.A} – {st.setsWon.B}
            </Text>
            <Text style={{ textAlign: 'center', color: colors.muted, fontWeight: '700', marginBottom: 8 }}>
              {st.sets.map((x) => `${x.a}-${x.b}`).join(' · ')}
            </Text>
            {/* Player of the Match: auto-picked, the scorer may change it, then confirms (core/potm.ts) */}
            <PotmPicker match={{ ...match, events: ev, status: 'finished', finishedAt: match.finishedAt ?? Date.now() }} uid={me.id} />
            <Button
              title={tr('score.shareResult')}
              icon="share-social"
              onPress={() => Share.share({ message: shareText(match.teamA.name, match.teamB.name, match.rules, ev, match.firstServe, { location: match.location?.name }) })}
            />
            <Button title={tr('score.summaryPhotos')} variant="dark" icon="images" onPress={() => router.replace(`/match/${match.id}`)} />
            {closed ? null : <Button title={tr('score.undoLast')} variant="ghost" icon="arrow-undo" onPress={doUndo} testID="undo-last" />}
          </View>
          </ScrollView>
        </View>
      </Modal>

      <LineupPicker
        visible={lineupOpen}
        match={match}
        setNumber={rot.setIndex + 1}
        initial={{
          A: startingLineup(match.lineups, rot.setIndex + 1, 'A', rosterIds.A),
          B: startingLineup(match.lineups, rot.setIndex + 1, 'B', rosterIds.B),
        }}
        screenSide={{ [left]: 'left', [right]: 'right' } as Record<Side, 'left' | 'right'>}
        onSave={saveLineup}
        onClose={() => setLineupOpen(false)}
      />

      {/* menu */}
      <Modal visible={menu} transparent animationType="slide" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.modalBg} onPress={() => setMenu(false)}>
          <View style={[s.modal, { marginTop: 'auto', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
            <Text style={[s.winner, { fontSize: 20 }]}>{tr('score.options')}</Text>
            <Button title={tr('score.shareLive')} icon="share-social" onPress={() => { setMenu(false); Share.share({ message: shareText(match.teamA.name, match.teamB.name, match.rules, ev, match.firstServe) }); }} />
            <Button title={tr('score.pointByPoint')} icon="list" variant="secondary" onPress={() => { setMenu(false); router.replace(`/match/${match.id}`); }} />
            {hasPlayers && (
              <Button
                title={tr('rotation.lineup')}
                icon="people"
                variant="secondary"
                onPress={() => {
                  setMenu(false);
                  if (canSetLineup) setLineupOpen(true);
                  else flash(tr('rotation.onlyAtSetStart'));
                }}
              />
            )}
            <Button
              title={tr('score.abandon')}
              icon="close-circle"
              variant="danger"
              testID="menu-abandon"
              loading={abandoning}
              onPress={abandon}
            />
            <Button title={tr('common.close')} variant="ghost" onPress={() => setMenu(false)} />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function AttributionRow({ players, color, onPick, onDone }: { players: Match['teamA']['players']; color: string; onPick: (id: string, k?: PointKind) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [player, setPlayer] = useState<string | null>(null);
  const picked = players.find((p) => p.id === player);
  return (
    <View>
      <View style={s.playerGrid}>
        {players.slice(0, 12).map((p) => (
          <Pressable
            key={p.id}
            testID={`credit-${p.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: player === p.id }}
            onPress={() => {
              haptic('select');
              setPlayer(p.id);
              onPick(p.id); // counts for them now; the shot type below is optional
            }}
            style={[s.player, player === p.id && s.playerOn]}
          >
            {/* QA C131-1: the tick sits on the avatar (not beside the name), and the name may wrap to 2
                lines or shrink a little, so the selected chip never cuts the name to "Aa…" (EN/HI). */}
            <View>
              <Avatar name={p.name} uri={p.photoURL} size={32} color={color} />
              {player === p.id && (
                <View style={s.playerTick} testID={`credit-tick-${p.id}`}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.primaryText} />
                </View>
              )}
            </View>
            <Text style={s.playerName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} testID={`credit-name-${p.id}`}>
              {p.name.split(' ')[0]}
            </Text>
          </Pressable>
        ))}
      </View>
      {player && picked && (
        <>
          <Text style={s.creditedText} testID="credited-to">
            {t('score.creditedTo', { name: picked.name.split(' ')[0] })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 }}>
            {POINT_KINDS.map((k) => (
              <Pressable key={k} onPress={() => onPick(player, k)} style={s.kind} testID={`kind-${k}`} accessibilityRole="button">
                <Text style={s.kindText} numberOfLines={1}>
                  {t(`kinds.${k}`)}
                </Text>
              </Pressable>
            ))}
            <Pressable onPress={onDone} style={[s.kind, { backgroundColor: colors.primary, borderColor: colors.primary }]} testID="kind-none" accessibilityRole="button">
              <Text style={[s.kindText, { color: colors.onPrimary }]} numberOfLines={1}>
                {t('score.done')}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function syncLabel(s: SyncState, t: TFunction) {
  return { synced: t('score.syncSynced'), saving: t('score.syncSaving'), offline: t('score.syncOffline'), error: t('score.syncError') }[s];
}

const s = StyleSheet.create({
  header: { backgroundColor: colors.ink, paddingBottom: 10, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  creditedText: { color: colors.text, fontWeight: '700', fontSize: 13, marginTop: 10 },
  topTitle: { color: colors.white, fontWeight: '800', fontSize: 16 },
  topSub: { color: colors.onInkMuted, fontWeight: '600', fontSize: 12 },
  setStrip: { gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  setPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.ink2, borderRadius: 999, paddingHorizontal: 12, height: 30 },
  setPillNow: { backgroundColor: colors.primary },
  setPillText: { color: colors.white, fontWeight: '800', fontSize: 13, fontVariant: ['tabular-nums'] },
  teamBtns: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginTop: 10 },
  pointBanner: { alignSelf: 'center', backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 4, marginTop: 8 },
  pointBannerText: { color: colors.ink, fontWeight: '900', fontSize: 13 },
  oppHint: { color: colors.muted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 8, marginHorizontal: 16 },
  error: { backgroundColor: colors.danger, color: colors.white, textAlign: 'center', padding: 6, fontWeight: '800' },
  halves: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12 },
  lineupBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 14, minHeight: 36, marginTop: 10, maxWidth: '92%' },
  lineupBarText: { color: colors.onPrimary, fontWeight: '800', marginLeft: 6, flexShrink: 1 },
  bottom: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 10, backgroundColor: colors.white, ...elevation.barTop },
  undo: { flex: 1, minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  // Tester 1.2.0: the disabled Undo must look disabled (solid grey, grey text, no glow).
  undoDisabled: { backgroundColor: colors.disabledBg },
  undoText: { fontWeight: '900', fontSize: 16 },
  undoSub: { fontWeight: '600', fontSize: 12, marginTop: 1 },
  tile: { width: 64, minHeight: 56, borderRadius: 14, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileText: { color: colors.ink, fontWeight: '700', fontSize: 11 },
  toast: { position: 'absolute', top: '40%', alignSelf: 'center', backgroundColor: colors.toast, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16 },
  toastText: { color: colors.white, fontWeight: '900', fontSize: 18 },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, ...elevation.e3 },
  attribTitle: { color: colors.text, fontWeight: '800', flex: 1, fontSize: 16 },
  skip: { color: colors.primaryText, fontWeight: '800', fontSize: 15 },
  playerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  player: { width: '31.5%', minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, borderRadius: 12, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white },
  playerOn: { borderColor: colors.primaryText, backgroundColor: colors.tint },
  playerName: { color: colors.text, fontWeight: '700', fontSize: 13, lineHeight: 16, flex: 1, flexShrink: 1 },
  playerTick: { position: 'absolute', right: -5, bottom: -4, backgroundColor: colors.white, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  kind: { backgroundColor: colors.tint, borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border },
  kindText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  modalBg: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'center', padding: 20 },
  modal: { backgroundColor: colors.white, borderRadius: 22, padding: 20 },
  winner: { fontSize: 26, fontWeight: '900', textAlign: 'center', color: colors.text },
  final: { fontSize: 48, fontWeight: '900', textAlign: 'center', color: colors.text },
});

/** Shown instead of the scoreboard while a team has fewer than MIN_PLAYERS players. */
function NeedPlayers({ match, onUpdated }: { match: Match; onUpdated: (m: Match) => void }) {
  const { t: tr } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = !!(match.teamA.teamId || match.teamB.teamId);
  // Registered-team sides can pick up players who joined the team since the match was created.
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = async (side: Match['teamA']) => {
        if (!side.teamId) return side;
        const team = await getOnce<Team | null>((cb) => backend.watchTeam(side.teamId!, cb));
        return team ? { ...(await matchTeamFromTeam(team)), name: side.name, color: side.color } : side;
      };
      const [teamA, teamB] = await Promise.all([fresh(match.teamA), fresh(match.teamB)]);
      const participantIds = orderedParticipants(teamA, teamB, [match.createdBy, match.scorerId]);
      await backend.updateMatch(match.id, { teamA, teamB, participantIds });
      onUpdated({ ...match, teamA, teamB, participantIds });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.bg }} testID="need-players">
      <Ionicons name="people" size={48} color={colors.ink} style={{ alignSelf: 'center', marginBottom: 8 }} />
      <Text style={{ fontSize: 22, fontWeight: '900', textAlign: 'center', color: colors.text, marginBottom: 8 }}>{tr('score.needPlayersTitle')}</Text>
      <P style={{ textAlign: 'center', marginBottom: 12 }}>{tr('score.needPlayers', { min: MIN_PLAYERS })}</P>
      {[match.teamA, match.teamB].map((t, i) => (
        <Text key={i} style={{ textAlign: 'center', fontWeight: '800', fontSize: 16, color: t.players.length >= MIN_PLAYERS ? colors.text : colors.danger, marginBottom: 4 }}>
          {tr('score.sideCount', { team: t.name, count: t.players.length, min: MIN_PLAYERS })}
        </Text>
      ))}
      {linked && <P muted style={{ textAlign: 'center', marginVertical: 12 }}>{tr('score.rosterHelp')}</P>}
      {linked && <Button title={tr('score.refreshRoster')} icon="refresh" onPress={refresh} loading={busy} testID="refresh-roster" />}
      {error && <Text style={{ color: colors.danger, fontWeight: '700', textAlign: 'center' }}>{error}</Text>}
      <Button title={tr('common.back')} variant="ghost" onPress={() => goBackOr(`/match/${match.id}`)} />
    </SafeAreaView>
  );
}

