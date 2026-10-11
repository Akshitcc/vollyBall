import { router, useLocalSearchParams } from 'expo-router';
import { firstFutureHour, isPastStart, localAt, localDayOffset, localDayStart } from '../../core/dates';
import { LIMITS } from '../../core/limits';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
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
import { formatDayChipT, hourLabel, translateError } from '../../i18n/format';
import { colors, elevation, onColor, readableFill, type } from '../../theme';
import { captainsProblem } from '../../core/antifraud';

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
  testID,
}: {
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
  const teamChip = (t: Team) => (
    <Chip key={t.id} label={t.name} color={t.color} active={value?.kind === 'team' && value.team.id === t.id} onPress={() => onChange({ kind: 'team', team: t })} />
  );
  return (
    <View style={[card, { marginBottom: 12 }]}>
      <Row style={{ marginBottom: 10 }}>
        <View style={[st.badge, { backgroundColor: readableFill(value?.kind === 'team' ? value.team.color : value?.kind === 'build' ? value.color : defaultColor) }]}>
          <Text style={{ color: onColor(readableFill(value?.kind === 'team' ? value.team.color : value?.kind === 'build' ? value.color : defaultColor)), fontWeight: '800' }}>{badge}</Text>
        </View>
        <Text style={[type.h2, { color: colors.text, marginLeft: 8, flex: 1 }]}>{label}</Text>
        {value ? <Ionicons name="checkmark-circle" size={20} color={colors.successStrong} /> : <Text style={[type.caption, { color: colors.muted }]}>{tr('newMatch.required')}</Text>}
      </Row>
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
    </View>
  );
}

export default function NewMatch() {
  const { t } = useTranslation();
  const me = useMe();
  const params = useLocalSearchParams<{ teamId?: string; courtId?: string }>();
  const myTeams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]) ?? [];
  const [a, setA] = useState<SideInput>(null);
  const [b, setB] = useState<SideInput>(null);
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
  const now = Date.now();
  const selDay = when === 'now' ? null : localDayOffset(when, now);
  const selHour = when === 'now' ? null : new Date(when).getHours();
  const hourPast = (d: number, h: number) => d === 0 && isPastStart(localAt(0, h, now), now, 0);
  const pick = (d: number, h: number) => setWhen(localAt(d, hourPast(d, h) ? (firstFutureHour(hours, d, now) ?? h) : h, now));

  const colorOf = (v: SideInput) => (v?.kind === 'team' ? v.team.color : v?.kind === 'build' ? v.color : null);
  const sideOk = (v: SideInput) => !!v && (v.kind === 'team' ? teamCanPlay(v.team) : !!v.name.trim() && v.players.length >= MIN_PLAYERS);
  const step = !sideOk(a) || !sideOk(b) ? 0 : 1;

  return (
    <KeyboardAwareScreen edges={[]} header={<Stepper step={step} />}>
      <SidePicker label={t('common.teamA')} badge="A" value={a} onChange={setA} myTeams={myTeams} defaultColor={TEAM_COLORS[0]} otherPlayerIds={playerIdsOf(b, rosters)} otherTeamId={b?.kind === 'team' ? b.team.id : null} otherColor={colorOf(b)} testID="side-a" />
      <CaptainPicker side="A" value={a} captain={capA} onChange={setCapA} />
      <SidePicker label={t('common.teamB')} badge="B" value={b} onChange={setB} myTeams={myTeams} defaultColor={TEAM_COLORS[1]} otherPlayerIds={playerIdsOf(a, rosters)} otherTeamId={a?.kind === 'team' ? a.team.id : null} otherColor={colorOf(a)} testID="side-b" />
      <CaptainPicker side="B" value={b} captain={capB} onChange={setCapB} />
      <Card>
        <RulesEditor value={rules} onChange={setRules} />
        <Text style={ui.label}>{t('newMatch.firstServe')}</Text>
        <Row>
          <Chip label={t('common.teamA')} active={firstServe === 'A'} onPress={() => setFirstServe('A')} />
          <Chip label={t('common.teamB')} active={firstServe === 'B'} onPress={() => setFirstServe('B')} />
        </Row>
      </Card>
      <Card>
        <Text style={ui.label}>{t('newMatch.when')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label={t('newMatch.startNow')} active={when === 'now'} onPress={() => setWhen('now')} />
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
      <P muted style={{ marginBottom: 8 }}>{t('newMatch.scorerNote')}</P>
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={when === 'now' ? t('newMatch.start') : t('newMatch.scheduleMatch')} icon="play" big onPress={create} loading={busy} testID="create-match" />
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

/** 3-step progress strip in the navy header (Teams → Rules → Start), design-spec §8 05. */
function Stepper({ step }: { step: number }) {
  const { t } = useTranslation();
  const steps = [t('newMatch.stepTeams'), t('newMatch.stepRules'), t('newMatch.stepStart')];
  return (
    <View style={st.stepper} testID="new-match-stepper" accessible accessibilityLabel={t('newMatch.stepOf', { n: step + 1, total: 3 })}>
      {steps.map((label, i) => (
        <View key={label} style={{ flex: 1, marginRight: i < 2 ? 6 : 0 }}>
          <View style={[st.seg3, { backgroundColor: i <= step ? colors.primary : colors.ink2 }]} />
          <Text style={{ color: i <= step ? colors.onInk : colors.onInkMuted, fontWeight: '700', fontSize: 12, marginTop: 6 }} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
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
});
