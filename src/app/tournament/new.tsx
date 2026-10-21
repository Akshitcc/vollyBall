import { Ionicons } from '@expo/vector-icons';
import { tournamentDates } from '../../core/dates';
import { cleanText } from '../../core/text';
import { LIMITS, MAX_TOURNAMENT_TEAMS } from '../../core/limits';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';
import { LocationPicker, placeReady } from '../../components/LocationPicker';
import { RulesEditor } from '../../components/RulesEditor';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Button, Card, Chip, Field, H2, P, Row, styles as ui, TeamDot } from '../../components/ui';
import type { Place } from '../../core/geo';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { generateKnockout, generateRoundRobin, type TournamentFormat } from '../../core/tournament';
import { assignGroups, generateGroupsKnockout, groupId, groupPlans, MIN_GROUPS_TEAMS, playIn, seededRandom, type GroupMode } from '../../core/groups';
import { MIN_PLAYERS, teamCanPlay, tournamentCandidates } from '../../core/roster';
import { distinctColor, type Team, type TournamentTeam } from '../../core/types';
import { backend } from '../../services/backend';
import { useMe } from '../../state/AuthContext';
import { translateError } from '../../i18n/format';
import { colors } from '../../theme';

export default function NewTournament() {
  const { t: tr } = useTranslation();
  const me = useMe();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('knockout');
  const [rules, setRules] = useState<RuleSet>({ ...INDOOR_RULES, bestOf: 3, preset: 'custom' });
  const [startIn, setStartIn] = useState(7);
  const [days, setDays] = useState(1);
  const [location, setLocation] = useState<Place | null>(null);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Team[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 1.4.27 groups + knockout: plan (groups × advancing), seeded or random draw (a stable seed; "Draw again" changes it)
  const [planIdx, setPlanIdx] = useState(0);
  const [mode, setMode] = useState<GroupMode>('seeded');
  const [drawSeed, setDrawSeed] = useState(() => Date.now() % 100000);
  const plans = useMemo(() => groupPlans(teams.length).slice(0, 4), [teams.length]);
  const plan = plans[Math.min(planIdx, plans.length - 1)] ?? null;
  const groups = useMemo(
    () => (format === 'groups' && plan ? assignGroups(teams.map((x) => x.id), plan.groups, mode, seededRandom(drawSeed)) : []),
    [format, plan, teams, mode, drawSeed],
  );
  const pi = playIn(Math.max(2, teams.length));
  const planLabel = (p: NonNullable<typeof plan>) =>
    tr('newTournament.planLabel', { groups: p.groups, sizes: p.sizes.join('/'), advance: p.advance, round: tr(`newTournament.koFrom_${p.bracket}`), total: p.total });
  // 1.4.20 (QA V1419-8): a form error goes away by itself once its field is fixed
  const [errFor, setErrFor] = useState<'name' | 'location' | 'place' | 'teams' | null>(null);
  const fieldError = (k: NonNullable<typeof errFor>, text: string) => { setErrFor(k); setError(text); };
  useEffect(() => {
    if (!errFor) return;
    const fixed = errFor === 'name' ? cleanText(name).length >= LIMITS.tournamentName.min
      : errFor === 'location' ? !!location
        : errFor === 'place' ? placeReady(location)
          : teams.length >= 2;
    if (fixed) { setError(null); setErrFor(null); }
  }, [errFor, name, location, teams.length]);

  useEffect(() => {
    const t = setTimeout(() => backend.searchTeams(q).then(setResults), 250);
    return () => clearTimeout(t);
  }, [q]);

  const candidates = tournamentCandidates(results, teams.map((x) => x.id));
  // Registered teams only, each with at least MIN_PLAYERS members (their roster plays the fixtures).
  const addTeam = (t: Team) => {
    if (teams.some((x) => x.id === t.id)) return;
    if (teams.length >= MAX_TOURNAMENT_TEAMS) return setError(tr('errors.codes.too_many_teams', { max: MAX_TOURNAMENT_TEAMS }));
    if (!teamCanPlay(t)) return setError(tr('newTournament.teamTooSmall', { team: t.name, count: t.memberIds.length, min: MIN_PLAYERS }));
    setError(null);
    // Two teams with the same colour can't be told apart in fixtures and on the scoreboard (QA bug F).
    setTeams([...teams, { id: t.id, name: t.name, color: distinctColor(t.color, teams.map((x) => x.color)) }]);
  };

  const create = async () => {
    setError(null);
    setErrFor(null);
    if (cleanText(name).length < LIMITS.tournamentName.min) return fieldError('name', tr('newTournament.nameRequired'));
    if (!location) return fieldError('location', tr('newTournament.pickLocation'));
    if (!placeReady(location)) return fieldError('place', tr('location.nameRequired'));
    if (teams.length < 2) return fieldError('teams', tr('newTournament.minTeams'));
    if (format === 'groups' && (teams.length < MIN_GROUPS_TEAMS || !plan)) return fieldError('teams', tr('newTournament.groupsMinTeams', { min: MIN_GROUPS_TEAMS }));
    setBusy(true);
    try {
      const ids = teams.map((t) => t.id);
      const grouped = format === 'groups' && plan ? { groups, advance: plan.advance } : null;
      const teamsOut = grouped ? teams.map((x) => ({ ...x, group: groupId(grouped.groups.findIndex((g) => g.includes(x.id))) })) : teams;
      const { startDate, endDate } = tournamentDates(startIn, days);
      const id = await backend.createTournament({
        name: cleanText(name),
        organizerId: me.id,
        format,
        rules,
        startDate,
        endDate,
        location,
        teams: teamsOut,
        ...(grouped ? { advance: grouped.advance } : {}),
        fixtures: grouped ? generateGroupsKnockout(grouped.groups, grouped.advance) : format === 'knockout' ? generateKnockout(ids) : generateRoundRobin(ids),
        status: 'running',
      });
      router.replace(`/tournament/${id}`);
    } catch (e) {
      setError(translateError(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScreen edges={[]}>
      <Field label={tr('newTournament.name')} value={name} onChangeText={setName} placeholder={tr('newTournament.namePlaceholder')} maxLength={LIMITS.tournamentName.max} testID="tournament-name" />
      <Text style={ui.label}>{tr('newTournament.format')}</Text>
      <Row style={{ marginBottom: 6, flexWrap: 'wrap' }}>
        <Chip label={tr('newTournament.knockout')} active={format === 'knockout'} onPress={() => setFormat('knockout')} />
        <Chip label={tr('newTournament.league')} active={format === 'league'} onPress={() => setFormat('league')} />
        <Chip label={tr('newTournament.groups')} active={format === 'groups'} onPress={() => setFormat('groups')} testID="format-groups" />
      </Row>
      <P muted style={{ marginBottom: 12 }}>
        {format === 'knockout' ? tr('newTournament.knockoutHint') : format === 'groups' ? tr('newTournament.groupsHint') : tr('newTournament.leagueHint')}
      </P>
      {/* 1.4.27: knockout of a field that is not a power of two starts with a play-in round (top seeds get byes) */}
      {format === 'knockout' && teams.length > 2 && pi.byes > 0 ? (
        <P muted style={{ marginBottom: 12, fontSize: 12 }} testID="knockout-playin">{tr('newTournament.playInHint', { count: pi.playInMatches, teams: pi.playInMatches * 2, field: pi.field, total: pi.total })}</P>
      ) : null}
      <Card>
        <RulesEditor value={rules} onChange={setRules} />
      </Card>
      <Card>
        <Text style={ui.label}>{tr('newTournament.startsIn')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {[0, 1, 3, 7, 14, 30].map((d) => (
            <Chip key={d} label={d === 0 ? tr('common.today') : d === 1 ? tr('common.tomorrow') : tr('time.dayCount', { count: d })} active={startIn === d} onPress={() => setStartIn(d)} />
          ))}
        </Row>
        <Text style={ui.label}>{tr('newTournament.duration')}</Text>
        <Row>
          {[1, 2, 3].map((d) => (
            <Chip key={d} label={tr('time.dayCount', { count: d })} active={days === d} onPress={() => setDays(d)} />
          ))}
        </Row>
      </Card>
      <H2>{tr('newTournament.teams', { count: teams.length, max: MAX_TOURNAMENT_TEAMS })}</H2>
      {teams.map((t, i) => (
        <Row key={t.id} style={{ paddingVertical: 6 }}>
          <Text style={{ width: 26, fontWeight: '900', color: colors.muted }}>{i + 1}.</Text>
          <TeamDot color={t.color} size={14} style={{ marginRight: 8 }} />
          <Text style={{ flex: 1, fontWeight: '800', color: colors.text }} testID={`tour-team-name-${t.id}`}>{t.name}</Text>
          <Pressable accessibilityRole="button" onPress={() => setTeams(teams.filter((x) => x.id !== t.id))}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </Pressable>
        </Row>
      ))}
      <P muted style={{ fontSize: 12, marginBottom: 8 }}>{tr('newTournament.seeding')}</P>
      <Card>
        <P muted style={{ fontSize: 12, marginBottom: 8 }}>{tr('newTournament.registeredOnly', { min: MIN_PLAYERS })}</P>
        <Field label={tr('newTournament.addRegistered')} value={q} onChangeText={setQ} placeholder={tr('newTournament.searchTeam')} maxLength={LIMITS.teamSearch.max} />
        <Row style={{ flexWrap: 'wrap' }}>
          {/* teams already in the list above aren't offered again (QA retest) */}
          {teams.length >= MAX_TOURNAMENT_TEAMS ? (
            <Text testID="tournament-full" style={{ fontSize: 12, color: colors.muted }}>{tr('errors.codes.too_many_teams', { max: MAX_TOURNAMENT_TEAMS })}</Text>
          ) : (
            candidates.offered.map((t) => (
              <Chip key={t.id} label={`+ ${t.name}`} color={t.color} onPress={() => addTeam(t)} testID={`add-team-${t.id}`} />
            ))
          )}
        </Row>
        {/* QA B121-2: teams short of players aren't offered; say why they're missing */}
        {teams.length < MAX_TOURNAMENT_TEAMS && candidates.tooSmall.length > 0 ? (
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }} testID="tournament-too-small">
            {tr('newTournament.hiddenTooSmall', { count: candidates.tooSmall.length, min: MIN_PLAYERS })}
          </Text>
        ) : null}
      </Card>
      {format === 'groups' && (
        <Card testID="groups-setup">
          {!plan ? (
            <P muted testID="groups-min">{tr('newTournament.groupsMinTeams', { min: MIN_GROUPS_TEAMS })}</P>
          ) : (
            <>
              <Text style={ui.label}>{tr('newTournament.groupPlan')}</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {plans.map((p, i) => (
                  <Chip key={`${p.groups}-${p.advance}`} label={planLabel(p)} active={plan === p} onPress={() => setPlanIdx(i)} testID={`group-plan-${p.groups}x${p.advance}`} />
                ))}
              </Row>
              <Text style={ui.label}>{tr('newTournament.draw')}</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                <Chip label={tr('newTournament.drawSeeded')} active={mode === 'seeded'} onPress={() => setMode('seeded')} testID="draw-seeded" />
                <Chip label={tr('newTournament.drawRandom')} active={mode === 'random'} onPress={() => setMode('random')} testID="draw-random" />
                {mode === 'random' ? <Chip label={tr('newTournament.drawAgain')} onPress={() => setDrawSeed((x) => x + 1)} testID="draw-again" /> : null}
              </Row>
              <P muted style={{ fontSize: 12, marginTop: 4 }}>{mode === 'seeded' ? tr('newTournament.drawSeededHint') : tr('newTournament.drawRandomHint')}</P>
              <Text style={ui.label}>{tr('newTournament.groupsPreview')}</Text>
              <Row style={{ flexWrap: 'wrap', gap: 8 }} testID="groups-preview">
                {groups.map((g, gi) => (
                  <Card key={gi} style={{ minWidth: 140, flexGrow: 1, marginBottom: 0 }} testID={`preview-group-${groupId(gi)}`}>
                    <Text style={[ui.label, { marginTop: 0 }]}>{tr('tournament.group', { group: groupId(gi) })}</Text>
                    {g.map((tid) => {
                      const tm = teams.find((x) => x.id === tid);
                      return (
                        <Row key={tid} style={{ paddingVertical: 2 }}>
                          <TeamDot color={tm?.color ?? colors.muted} size={10} style={{ marginRight: 6 }} />
                          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{tm?.name}</Text>
                        </Row>
                      );
                    })}
                  </Card>
                ))}
              </Row>
              <P muted style={{ fontSize: 12, marginTop: 6 }} testID="groups-total">{tr('newTournament.groupsTotal', { group: plan.groupMatches, ko: plan.knockoutMatches, total: plan.total })}</P>
              {plan.byes > 0 ? <P muted style={{ fontSize: 12 }} testID="groups-byes">{tr('newTournament.groupsByes', { byes: plan.byes })}</P> : null}
            </>
          )}
        </Card>
      )}
      <H2>{tr('newTournament.venue')}</H2>
      <LocationPicker value={location} onChange={setLocation} />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={tr('newTournament.create')} icon="trophy" big onPress={create} loading={busy} testID="tournament-create" />
    </KeyboardAwareScreen>
  );
}
