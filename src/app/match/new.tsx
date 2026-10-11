import { router, Stack, useLocalSearchParams } from 'expo-router';
import { HeaderBackButton } from 'expo-router/react-navigation';
import { firstFutureHour, isPastStart, localAt, localDayOffset, localDayStart } from '../../core/dates';
import { LIMITS } from '../../core/limits';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { card } from '../../components/Hero';
import { PressableScale } from '../../components/PressableScale';
import { LocationPicker, placeReady } from '../../components/LocationPicker';
import { RulesEditor } from '../../components/RulesEditor';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Button, Card, Chip, Field, H2, P, Row, styles as ui } from '../../components/ui';
import { placeFromCourt, type Place } from '../../core/geo';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import type { Side } from '../../core/scoring';
import { TEAM_COLORS, type MatchTeam, type Team } from '../../core/types';
import { backend } from '../../services/backend';
import { TeamBuilder, type BuiltTeam } from '../../components/TeamBuilder';
import { MIN_PLAYERS, missingPlayers, ROSTER_MESSAGES, rosterErrors, teamCanPlay } from '../../core/roster';
import { buildMatch, matchTeamFromTeam } from '../../services/matchFactory';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { describeRulesT, formatDayChipT, hourLabel, translateError } from '../../i18n/format';
import { colors, elevation, onColor, readableFill, type } from '../../theme';
import { captainsProblem } from '../../core/antifraud';
import { SafeFooter } from '../../components/SafeFooter';
import { canOpenStep, previousStep, teamsProblem, type NewMatchStep, type SideSummary, type TeamsProblem } from '../../core/newMatchFlow';
import { goBackOr } from '../../services/nav';

/** A side is either a registered team or a roster built from registered players by number. */
type SideInput = { kind: 'team'; team: Team } | BuiltTeam | null;

const playerIdsOf = (v: SideInput, cache: Record<string, MatchTeam>) =>
  !v ? [] : v.kind === 'build' ? v.players.map((p) => p.id) : (cache[v.team.id]?.players.map((p) => p.id) ?? v.team.memberIds);

function SidePicker({
  label,
  value,
  onChange,
  myTeams,
  defaultColor,
  otherPlayerIds,
  otherTeamId,
  otherColor,
  badge,
  ready,
  open,
  onToggle,
  testID,
}: {
  /** 1.3.2: collapsed to its header row (mockup 05: "Team B · Tap to set up"). */
  open: boolean;
  onToggle: () => void;
  otherColor?: string | null;
  badge: 'A' | 'B';
  label: string;
  value: SideInput;
  onChange: (v: SideInput) => void;
  myTeams: Team[];
  defaultColor: string;
  otherPlayerIds: string[];
  /** The registered team already picked for the other side: not offered here (fix re-test 204). */
  otherTeamId?: string | null;
  /** Side complete (players, name, captain): tick in the header. */
  ready: boolean;
  testID: string;
}) {
  const { t: tr } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Team[]>([]);
  const [built, setBuilt] = useState<BuiltTeam>({ kind: 'build', name: '', color: defaultColor, players: [] });
  const [mode, setMode] = useState<'team' | 'build'>(value?.kind === 'build' ? 'build' : 'team');
  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => backend.searchTeams(q).then(setResults), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (value?.kind === 'build') setBuilt(value);
  }, [value]);
  const colorNow = value?.kind === 'team' ? value.team.color : value?.kind === 'build' ? value.color : defaultColor;
  const count = value?.kind === 'team' ? value.team.memberIds.length : value?.kind === 'build' ? value.players.length : 0;
  const name = value?.kind === 'team' ? value.team.name : value?.kind === 'build' ? value.name.trim() : '';
  const summary = value && (name || count) ? [name, tr('newMatch.summaryPlayers', { count })].filter(Boolean).join(' · ') : null;
  const teamChip = (t: Team) => (
    <Chip key={t.id} label={t.name} color={t.color} active={value?.kind === 'team' && value.team.id === t.id} onPress={() => onChange({ kind: 'team', team: t })} />
  );
  return (
    <View style={[card, { marginBottom: 12 }]} testID={testID}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${summary ?? tr(open ? 'newMatch.required' : 'newMatch.tapToSetUp')}`}
        testID={`${testID}-toggle`}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: open ? 10 : 0 }}
      >
        <View style={[st.badge, { backgroundColor: readableFill(colorNow) }]}>
          <Text style={{ color: onColor(readableFill(colorNow)), fontWeight: '800' }}>{badge}</Text>
        </View>
        <Text style={[type.h2, { color: colors.text, marginLeft: 8, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
        <View style={{ flex: 1 }} />
        {summary ? (
          <Text style={[type.caption, { color: colors.muted, marginRight: 6, flexShrink: 1 }]} numberOfLines={1}>{summary}</Text>
        ) : !open ? (
          <Text style={[type.caption, { color: colors.muted, marginRight: 6 }]}>{tr('newMatch.tapToSetUp')}</Text>
        ) : null}
        {ready ? <Ionicons name="checkmark-circle" size={20} color={colors.successStrong} /> : open ? <Text style={[type.caption, { color: colors.muted }]}>{tr('newMatch.required')}</Text> : null}
        {!open && <Ionicons name="chevron-down" size={18} color={colors.muted} style={{ marginLeft: 4 }} />}
      </Pressable>
      {open && (
      <>
      <View style={st.seg} accessibilityRole="tablist">
        {(
          [
            ['team', 'people-outline', 'newMatch.pickTeam', () => { setMode('team'); onChange(null); }],
            ['build', 'keypad-outline', 'newMatch.buildTeam', () => { setMode('build'); onChange(built); }],
          ] as const
        ).map(([m, icon, key, go]) => (
          <PressableScale key={m} onPress={go} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={[st.segItem, mode === m && st.segOn]} testID={`${testID}-mode-${m}`}>
            <Ionicons name={icon} size={16} color={mode === m ? colors.text : colors.muted} />
            <Text style={{ color: mode === m ? colors.text : colors.muted, fontWeight: '700', fontSize: 13, flexShrink: 1 }} numberOfLines={2}>
              {tr(key)}
            </Text>
          </PressableScale>
        ))}
      </View>
      {mode === 'team' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{myTeams.filter((t) => t.id !== otherTeamId).map(teamChip)}</View>
          <Field label={tr('newMatch.findTeam')} value={q} onChangeText={setQ} placeholder={tr('newMatch.searchTeam')} maxLength={LIMITS.teamSearch.max} testID={`${testID}-search`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{results.filter((t) => t.id !== otherTeamId && !myTeams.some((m) => m.id === t.id)).map(teamChip)}</View>
          {/* 1.3.4: the only match is the team already on the other side – say so instead of showing nothing */}
          {otherTeamId && results.some((t) => t.id === otherTeamId) && !results.some((t) => t.id !== otherTeamId) ? (
            <P muted testID={`${testID}-already-other`}>{tr('newMatch.alreadyOtherSide', { side: badge === 'A' ? 'B' : 'A' })}</P>
          ) : null}
          {value?.kind === 'team' &&
            (teamCanPlay(value.team) ? (
              <P muted>{tr('newMatch.fromTeam', { count: value.team.memberIds.length, team: value.team.name })}</P>
            ) : (
              <Text style={{ color: colors.danger, fontWeight: '700' }}>
                {tr('newMatch.teamTooSmall', { team: value.team.name, count: value.team.memberIds.length, min: MIN_PLAYERS })}
              </Text>
            ))}
        </>
      ) : (
        <TeamBuilder value={built} onChange={(v) => { setBuilt(v); onChange(v); }} otherPlayerIds={otherPlayerIds} otherColor={otherColor} testID={testID} />
      )}
      </>
      )}
    </View>
  );
}

export default function NewMatch() {
  const { t } = useTranslation();
  const me = useMe();
  const params = useLocalSearchParams<{ teamId?: string; courtId?: string }>();
  const myTeams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]) ?? [];
  // 1.3.2: one screen, three steps (Teams → Rules → Start). Every step stays mounted (only the current
  // one is shown), so nothing typed or picked is lost when moving between steps.
  const [step, setStep] = useState<NewMatchStep>(0);
  const [a, setA] = useState<SideInput>(null);
  const [b, setB] = useState<SideInput>(null);
  const [open, setOpen] = useState<{ A: boolean; B: boolean }>({ A: true, B: false });
  // Rosters of picked registered teams (loaded once per team, used for the both-teams check).
  const [rosters, setRosters] = useState<Record<string, MatchTeam>>({});
  useEffect(() => {
    for (const v of [a, b])
      if (v?.kind === 'team' && !rosters[v.team.id])
        matchTeamFromTeam(v.team)
          .then((mt) => setRosters((r) => ({ ...r, [v.team.id]: mt })))
          .catch(() => {});
  }, [a, b, rosters]);
  const [rules, setRules] = useState<RuleSet>({ ...INDOOR_RULES });
  const [firstServe, setFirstServe] = useState<Side>('A');
  const [location, setLocation] = useState<Place | null>(null);
  const [when, setWhen] = useState<'now' | number>('now');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1.3.0: the creator names the captain of a side built by number (a registered team's captain is fixed)
  const [capA, setCapA] = useState<string | null>(null);
  const [capB, setCapB] = useState<string | null>(null);

  // "Start a match here" on a court page fills in the court as the location.
  useEffect(() => {
    if (!params.courtId) return;
    let alive = true;
    backend
      .listCourts()
      .then((cs) => {
        const c = cs.find((x) => x.id === params.courtId);
        if (alive && c) setLocation((cur) => cur ?? placeFromCourt(c));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [params.courtId]);

  useEffect(() => {
    const t = myTeams.find((x) => x.id === params.teamId) ?? (myTeams.length === 1 ? myTeams[0] : null);
    if (t && !a) setA({ kind: 'team', team: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams.length]);

  const sideLabel = (s: 'A' | 'B') => (s === 'A' ? t('common.teamA') : t('common.teamB'));
  const summaryOf = (v: SideInput, cap: string | null): SideSummary | null =>
    !v ? null : v.kind === 'team' ? { kind: 'team', teamId: v.team.id, name: v.team.name, players: v.team.memberIds.length } : { kind: 'build', name: v.name, players: v.players.length, captain: cap };
  const problem = teamsProblem(summaryOf(a, capA), summaryOf(b, capB));
  const teamsReady = !problem;
  const now = Date.now();
  const rulesProblem = location && !placeReady(location) ? t('location.nameRequired') : when !== 'now' && isPastStart(when, now, 0) ? t('errors.codes.time_in_past') : null;
  const rulesReady = !rulesProblem;
  /** One side on its own is complete (picked, named, 6+ players, captain): the tick on its card. */
  const sideReady = (s: 'A' | 'B') => {
    const one = summaryOf(s === 'A' ? a : b, s === 'A' ? capA : capB);
    const own = teamsProblem(one, one);
    return !!one && (!own || own.code === 'sameTeams');
  };
  // Team A done and Team B still untouched: open Team B's card (it starts collapsed, mockup 05).
  const aReady = sideReady('A');
  useEffect(() => {
    if (aReady && !b) setOpen((o) => (o.B ? o : { ...o, B: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aReady]);
  const hint = (p: TeamsProblem | null): string | undefined => {
    if (!p) return undefined;
    switch (p.code) {
      case 'pickBoth':
        return t('newMatch.hintPickBoth');
      case 'nameRequired':
        return t('newMatch.hintName', { side: sideLabel(p.side) });
      case 'needPlayers':
        return t('newMatch.hintPlayers', { side: sideLabel(p.side), count: p.missing, min: MIN_PLAYERS });
      case 'captainRequired':
        return t('newMatch.hintCaptain', { side: sideLabel(p.side) });
      case 'sameTeams':
        return t('newMatch.sameTeams');
    }
  };

  // A step that became unreachable (e.g. a player removed) can't stay open.
  useEffect(() => {
    if (!canOpenStep(step, teamsReady, rulesReady) && step > 0) setStep(teamsReady ? 1 : 0);
  }, [step, teamsReady, rulesReady]);
  const goTo = (target: NewMatchStep) => {
    if (target === step || !canOpenStep(target, teamsReady, rulesReady)) return;
    setError(null);
    setStep(target);
  };
  /** Header arrow / Android back: previous step; leave the screen only from the Teams step. */
  const back = useCallback(() => {
    const prev = previousStep(step);
    if (prev == null) return false;
    setStep(prev);
    return true;
  }, [step]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [back]);

  const create = async () => {
    setError(null);
    if (!a || !b) return setError(t('newMatch.pickBoth'));
    if (a.kind === 'team' && b.kind === 'team' && a.team.id === b.team.id) return setError(t('newMatch.sameTeams'));
    for (const [v, side] of [[a, t('common.teamA')], [b, t('common.teamB')]] as const) {
      if (v.kind === 'build' && !v.name.trim()) return setError(t('newMatch.nameRequired', { side }));
      if (v.kind === 'team' && !teamCanPlay(v.team)) return setError(t('newMatch.teamTooSmall', { team: v.team.name, count: v.team.memberIds.length, min: MIN_PLAYERS }));
    }
    if (location && !placeReady(location)) return setError(t('location.nameRequired'));
    if (when !== 'now' && isPastStart(when, Date.now(), 0)) return setError(t('errors.codes.time_in_past'));
    setBusy(true);
    try {
      const side = async (v: NonNullable<SideInput>): Promise<MatchTeam> =>
        v.kind === 'team' ? (rosters[v.team.id] ?? (await matchTeamFromTeam(v.team))) : { teamId: null, name: v.name.trim(), color: v.color, players: v.players };
      const [ta, tb] = await Promise.all([side(a), side(b)]);
      // Same checks as every backend: registered players only, 6–12 per team, nobody twice.
      const problem = [...rosterErrors(ta, tb), ...missingPlayers(ta, tb)][0];
      if (problem) {
        setBusy(false);
        return setError(problem.code === 'needPlayers' ? t('newMatch.needPlayers', { min: MIN_PLAYERS }) : translateError(new Error(ROSTER_MESSAGES[problem.code])));
      }
      const captains = { A: a.kind === 'team' ? a.team.captainId : capA ?? '', B: b.kind === 'team' ? b.team.captainId : capB ?? '' };
      const capProblem = captainsProblem({ teamA: ta, teamB: tb, captains }, { A: a.kind === 'team' ? a.team.captainId : null, B: b.kind === 'team' ? b.team.captainId : null });
      if (capProblem) {
        setBusy(false);
        return setError(t(`errors.codes.${capProblem}`));
      }
      const startNow = when === 'now';
      const id = await backend.createMatch(
        buildMatch({
          teamA: ta,
          teamB: tb,
          rules,
          firstServe,
          createdBy: me.id,
          scorerId: me.id,
          location,
          scheduledAt: startNow ? Date.now() : when,
          startNow,
          title: title.trim() || undefined,
          captains,
        }),
      );
      if (startNow) router.replace(`/match/${id}/score`);
      else router.replace(`/match/${id}`);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  const days = [0, 1, 2, 3, 4, 5, 6];
  const hours = [6, 7, 8, 16, 17, 18, 19, 20];
  // Local calendar days on this device (src/core/dates.ts), never UTC (QA B2).
  const selDay = when === 'now' ? null : localDayOffset(when, now);
  const selHour = when === 'now' ? null : new Date(when).getHours();
  const hourPast = (d: number, h: number) => d === 0 && isPastStart(localAt(0, h, now), now, 0);
  const pick = (d: number, h: number) => setWhen(localAt(d, hourPast(d, h) ? (firstFutureHour(hours, d, now) ?? h) : h, now));

  const colorOf = (v: SideInput) => (v?.kind === 'team' ? v.team.color : v?.kind === 'build' ? v.color : null);
  const whenText =
    when === 'now'
      ? t('newMatch.nowLabel')
      : `${selDay === 0 ? t('common.today') : selDay === 1 ? t('common.tomorrow') : formatDayChipT(localDayStart(selDay ?? 1, now))} · ${hourLabel(selHour ?? 18, t)}`;

  const footer =
    step === 0 ? (
      <SafeFooter testID="new-match-footer">
        <Button
          title={`${teamsReady ? t('newMatch.nextRules') : t('newMatch.nextRulesNeeds', { min: MIN_PLAYERS })} →`}
          disabled={!teamsReady}
          disabledHint={hint(problem)}
          onPress={() => goTo(1)}
          testID="next-rules"
        />
      </SafeFooter>
    ) : step === 1 ? (
      <SafeFooter testID="new-match-footer">
        <Row style={{ gap: 10 }}>
          <Button title={t('newMatch.back')} variant="secondary" onPress={back} style={{ flex: 1 }} testID="step-back" />
          <Button title={`${t('newMatch.nextStart')} →`} disabled={!rulesReady} disabledHint={rulesProblem ?? undefined} onPress={() => goTo(2)} style={{ flex: 2 }} testID="next-start" />
        </Row>
      </SafeFooter>
    ) : (
      <SafeFooter testID="new-match-footer">
        <Row style={{ gap: 10, alignItems: 'stretch' }}>
          <Button title={t('newMatch.back')} variant="secondary" onPress={back} style={{ flex: 1 }} testID="step-back" />
          <Button title={when === 'now' ? t('newMatch.start') : t('newMatch.scheduleMatch')} icon="play" big onPress={create} loading={busy} style={{ flex: 2 }} testID="create-match" />
        </Row>
      </SafeFooter>
    );

  const teamCard = (s: 'A' | 'B') => {
    const v = s === 'A' ? a : b;
    const cap = s === 'A' ? capA : capB;
    const players = v?.kind === 'build' ? v.players : v?.kind === 'team' ? (rosters[v.team.id]?.players ?? []) : [];
    const capId = v?.kind === 'team' ? v.team.captainId : cap;
    const capName = players.find((p) => p.id === capId)?.name;
    const count = v?.kind === 'team' ? v.team.memberIds.length : players.length;
    const col = colorOf(v) ?? TEAM_COLORS[s === 'A' ? 0 : 1];
    return (
      <View style={st.sumRow} testID={`summary-team-${s}`}>
        <View style={[st.badge, { backgroundColor: readableFill(col) }]}>
          <Text style={{ color: onColor(readableFill(col)), fontWeight: '800' }}>{s}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[type.h2, { color: colors.text }]} numberOfLines={2}>{v?.kind === 'team' ? v.team.name : v?.name.trim() || sideLabel(s)}</Text>
          <Text style={{ color: colors.muted, fontWeight: '600' }}>
            {t('newMatch.summaryPlayers', { count })}
            {capName ? ` · ${t('newMatch.summaryCaptain', { name: capName })}` : ''}
          </Text>
        </View>
      </View>
    );
  };
  const sumSection = (label: string, target: NewMatchStep, body: React.ReactNode, testID: string) => (
    <View style={st.sumSection} testID={testID}>
      <Row style={{ marginBottom: 6 }}>
        <Text style={[ui.label, { flex: 1, marginBottom: 0 }]}>{label}</Text>
        <PressableScale onPress={() => goTo(target)} accessibilityRole="button" accessibilityLabel={t('newMatch.changeStep', { label })} hitSlop={8} testID={`${testID}-change`}>
          <Text style={{ color: colors.primaryText, fontWeight: '800' }}>{t('newMatch.change')}</Text>
        </PressableScale>
      </Row>
      {body}
    </View>
  );

  const shown = (i: NewMatchStep) => (step === i ? null : st.hidden);

  return (
    <KeyboardAwareScreen edges={[]} header={<Stepper step={step} canOpen={(i) => canOpenStep(i, teamsReady, rulesReady)} onOpen={goTo} />} footer={footer} scrollKey={step}>
      <Stack.Screen
        options={{
          // Header arrow follows the steps too (Android back is handled by BackHandler above).
          headerLeft: () => (
            <HeaderBackButton onPress={() => back() || goBackOr('/')} tintColor={colors.white} accessibilityLabel={t('common.goBack')} testID="header-back" />
          ),
          headerRight: () => (
            <Text style={{ color: colors.onInkMuted, fontWeight: '700', marginRight: Platform.OS === 'web' ? 16 : 0 }} testID="new-match-step-of">
              {t('newMatch.stepOf', { n: step + 1, total: 3 })}
            </Text>
          ),
          gestureEnabled: step === 0,
        }}
      />
      {/* Step 1 – Teams */}
      <View style={shown(0)} testID="new-match-step-teams">
        <SidePicker label={t('common.teamA')} badge="A" value={a} onChange={setA} myTeams={myTeams} defaultColor={TEAM_COLORS[0]} otherPlayerIds={playerIdsOf(b, rosters)} otherTeamId={b?.kind === 'team' ? b.team.id : null} otherColor={colorOf(b)} ready={sideReady('A')} open={open.A} onToggle={() => setOpen((o) => ({ ...o, A: !o.A }))} testID="side-a" />
        {open.A && <CaptainPicker side="A" value={a} captain={capA} onChange={setCapA} />}
        <SidePicker label={t('common.teamB')} badge="B" value={b} onChange={setB} myTeams={myTeams} defaultColor={TEAM_COLORS[1]} otherPlayerIds={playerIdsOf(a, rosters)} otherTeamId={a?.kind === 'team' ? a.team.id : null} otherColor={colorOf(a)} ready={sideReady('B')} open={open.B} onToggle={() => setOpen((o) => ({ ...o, B: !o.B }))} testID="side-b" />
        {open.B && <CaptainPicker side="B" value={b} captain={capB} onChange={setCapB} />}
      </View>
      {/* Step 2 – Rules */}
      <View style={shown(1)} testID="new-match-step-rules">
        <Card>
          <RulesEditor value={rules} onChange={setRules} />
          <Text style={ui.label}>{t('newMatch.firstServe')}</Text>
          <Row>
            <Chip label={t('common.teamA')} active={firstServe === 'A'} onPress={() => setFirstServe('A')} testID="first-serve-A" />
            <Chip label={t('common.teamB')} active={firstServe === 'B'} onPress={() => setFirstServe('B')} testID="first-serve-B" />
          </Row>
        </Card>
        <Card>
          <Text style={ui.label}>{t('newMatch.when')}</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label={t('newMatch.startNow')} active={when === 'now'} onPress={() => setWhen('now')} testID="when-now" />
            <Chip label={t('newMatch.schedule')} active={when !== 'now'} onPress={() => setWhen(localAt(1, 18, now))} testID="when-schedule" />
          </Row>
          {when !== 'now' && (
            <>
              <Row style={{ flexWrap: 'wrap' }}>
                {days.map((d) => (
                  <Chip
                    key={d}
                    label={d === 0 ? t('common.today') : d === 1 ? t('common.tomorrow') : formatDayChipT(localDayStart(d, now))}
                    active={selDay === d}
                    disabled={d === 0 && firstFutureHour(hours, 0, now) == null}
                    onPress={() => pick(d, selHour ?? 18)}
                    testID={`match-day-${d}`}
                  />
                ))}
              </Row>
              <Row style={{ flexWrap: 'wrap' }}>
                {hours.map((h) => (
                  <Chip key={h} label={hourLabel(h, t)} active={selHour === h} disabled={hourPast(selDay ?? 1, h)} onPress={() => setWhen(localAt(selDay ?? 1, h, now))} testID={`match-hour-${h}`} />
                ))}
              </Row>
            </>
          )}
          <Field label={t('newMatch.title')} value={title} onChangeText={setTitle} placeholder={t('newMatch.titlePlaceholder')} maxLength={LIMITS.matchTitle.max} testID="match-title" />
        </Card>
        <H2>{t('common.where')}</H2>
        <LocationPicker value={location} onChange={setLocation} />
      </View>
      {/* Step 3 – Start */}
      <View style={shown(2)} testID="new-match-step-start">
        <Text style={[type.h2, { color: colors.text, marginBottom: 10 }]}>{t('newMatch.summaryTitle')}</Text>
        <View style={card}>
          {sumSection(
            t('newMatch.stepTeams'),
            0,
            <>
              {teamCard('A')}
              <Text style={st.vs}>{t('common.vs')}</Text>
              {teamCard('B')}
            </>,
            'summary-teams',
          )}
          {sumSection(
            t('newMatch.summaryRules'),
            1,
            <>
              <Text style={st.sumText}>{describeRulesT(rules, t)}</Text>
              <Text style={st.sumMuted}>{t('newMatch.firstServeSide', { side: sideLabel(firstServe) })}</Text>
            </>,
            'summary-rules',
          )}
          {sumSection(t('newMatch.summaryWhen'), 1, <Text style={st.sumText}>{whenText}{title.trim() ? ` · ${title.trim()}` : ''}</Text>, 'summary-when')}
          {sumSection(t('newMatch.summaryCourt'), 1, <Text style={st.sumText}>{location?.name?.trim() || t('newMatch.noCourt')}</Text>, 'summary-court')}
          <View style={[st.sumSection, { borderBottomWidth: 0 }]} testID="summary-scorer">
            <Text style={ui.label}>{t('newMatch.summaryScorer')}</Text>
            <Text style={st.sumText}>{t('newMatch.scorerYou', { name: me.name })}</Text>
            <Text style={st.sumMuted}>{t('newMatch.scorerNote')}</Text>
          </View>
        </View>
        {error && <Text style={{ color: colors.danger, fontWeight: '700', marginTop: 8 }} accessibilityRole="alert" testID="new-match-error">{error}</Text>}
      </View>
    </KeyboardAwareScreen>
  );
}

/**
 * 1.3.0 anti-fraud: a side built by number needs a captain named by the creator (a player of that
 * side); the other side's captain later confirms the result. A registered team's captain is shown.
 */
function CaptainPicker({ side, value, captain, onChange }: { side: 'A' | 'B'; value: SideInput; captain: string | null; onChange: (id: string | null) => void }) {
  const { t } = useTranslation();
  const players = value?.kind === 'build' ? value.players : [];
  // drop a captain who was removed from the side
  useEffect(() => {
    if (captain && !players.some((p) => p.id === captain)) onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.map((p) => p.id).join(',')]);
  if (!value || value.kind !== 'build' || players.length === 0) return null;
  return (
    <Card>
      <Text style={ui.label} nativeID={`captain-${side}-label`}>{t('captainPick.title')} · {value.name || (side === 'A' ? t('common.teamA') : t('common.teamB'))}</Text>
      <P muted style={{ marginBottom: 8 }}>{t('captainPick.hint')}</P>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup" accessibilityLabelledBy={`captain-${side}-label`} testID={`captain-${side}`}>
        {players.map((p) => (
          <Chip key={p.id} label={p.name} active={captain === p.id} onPress={() => onChange(p.id)} testID={`captain-${side}-${p.id}`} />
        ))}
      </View>
    </Card>
  );
}

/**
 * 3-step progress strip in the navy header (Teams → Rules → Start), design-spec §8 05. 1.3.2: the
 * steps are tabs: any earlier step can be opened, a later one only when the steps before it are done
 * (disabled tabs say so to screen readers).
 */
function Stepper({ step, canOpen, onOpen }: { step: NewMatchStep; canOpen: (i: NewMatchStep) => boolean; onOpen: (i: NewMatchStep) => void }) {
  const { t } = useTranslation();
  const steps = [t('newMatch.stepTeams'), t('newMatch.stepRules'), t('newMatch.stepStart')];
  return (
    <View style={st.stepper} testID="new-match-stepper" accessibilityRole="tablist" accessibilityLabel={t('newMatch.stepOf', { n: step + 1, total: 3 })}>
      {steps.map((label, idx) => {
        const i = idx as NewMatchStep;
        const enabled = canOpen(i);
        const done = i <= step;
        return (
          <Pressable
            key={label}
            onPress={() => enabled && onOpen(i)}
            disabled={!enabled}
            accessibilityRole="tab"
            accessibilityLabel={t('newMatch.stepTab', { n: i + 1, total: 3, label })}
            accessibilityState={{ selected: i === step, disabled: !enabled }}
            accessibilityHint={enabled ? undefined : t('newMatch.stepLocked')}
            hitSlop={{ top: 8, bottom: 8 }}
            style={{ flex: 1, marginRight: i < 2 ? 6 : 0, minHeight: 36, justifyContent: 'flex-end' }}
            testID={`step-tab-${i}`}
          >
            <View style={[st.seg3, { backgroundColor: done ? colors.primary : colors.ink2 }]} />
            <Text style={{ color: i === step ? colors.onInk : colors.onInkMuted, fontWeight: i === step ? '800' : '700', fontSize: 12, marginTop: 6 }} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  stepper: { flexDirection: 'row', backgroundColor: colors.ink, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  seg3: { height: 4, borderRadius: 2 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 12, padding: 4, marginBottom: 10 },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: 10, paddingHorizontal: 6 },
  segOn: { backgroundColor: colors.white, ...elevation.e1 },
  hidden: { display: 'none' },
  sumSection: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sumRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  sumText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  sumMuted: { color: colors.muted, fontWeight: '600', marginTop: 2 },
  vs: { color: colors.muted, fontWeight: '800', marginLeft: 38, marginVertical: 2 },
});
