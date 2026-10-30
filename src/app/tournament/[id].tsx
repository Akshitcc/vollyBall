import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { Banner, Button, Empty, Loading, P, Row, Screen, breakWords } from '../../components/ui';
import { fixtureResultFromMatch } from '../../core/results';
import { fixtureTitle, isBye, leagueChampion, resolveKnockout, standings, type Fixture, type FixtureResult, type StandingRow, teamsWithoutFixtures } from '../../core/tournament';
import { resolveGroupsKnockout, tiebreakNames, type GroupTable } from '../../core/groups';
import type { Match, MatchTeam, Team, Tournament } from '../../core/types';
import { backend } from '../../services/backend';
import { MIN_PLAYERS } from '../../core/roster';
import { buildMatch, getOnce, matchTeamFromTeam } from '../../services/matchFactory';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { describeRulesT, formatDateRangeT, roundNameT, translateError } from '../../i18n/format';
import { colors, font } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { SegmentedControl } from '../../components/DayNightKit';
import { Blob, Body, Display, Glow, LivePill, Over, Sticker, useKit } from '../../components/DNKit';
import { claimedTournamentMatches, isTournamentAdmin } from '../../core/tournamentAdmin';
import { confirmAsk } from '../../services/dialogs';
import { placeLabelT } from '../../i18n/format';

/** 1.5.0 (QA V1428-4): narrower bracket cards – at 360 px the next round starts inside the screen (with the hint). */
const BRACKET_CARD_W = 168;

export default function TournamentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr } = useTranslation();
  const me = useMe();
  const t = useWatch<Tournament | null>((cb) => backend.watchTournament(id, cb), [id]);
  const tagged = useWatch<Match[]>((cb) => backend.watchTournamentMatches(id, cb), [id]);
  // 1.4.19: only the matches the owner put in a fixture count (core/tournamentAdmin)
  const matches = useMemo(() => claimedTournamentMatches(t, tagged ?? []), [t, tagged]);
  const [starting, setStarting] = useState<string | null>(null);
  const k = useKit();
  const [tab, setTab] = useState<'table' | 'groups' | 'bracket' | 'fixtures' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!t) return null;
    const results: FixtureResult[] = matches.map(fixtureResultFromMatch).filter((r): r is FixtureResult => !!r);
    const byFixture = new Map(matches.filter((m) => m.fixtureId).map((m) => [m.fixtureId!, m]));
    const teamIds = t.teams.map((x) => x.id);
    const names = tiebreakNames(t); // 1.4.26 (E2E-1) / 1.4.28 (V1427-1): the one shared name tie-break (core/groups)
    if (t.format === 'knockout') {
      const ko = resolveKnockout(t.fixtures, results);
      return { fixtures: ko.fixtures, champion: ko.championId, table: null, groups: null as GroupTable[] | null, byFixture, unscheduled: [] as string[] };
    }
    if (t.format === 'groups') {
      // 1.4.27: group tables (league order + name) feed the seeded bracket automatically (core/groups)
      const g = resolveGroupsKnockout(t, results, names);
      return { fixtures: g.fixtures, champion: g.championId, table: null, groups: g.tables, byFixture, unscheduled: [] as string[] };
    }
    return { fixtures: t.fixtures, champion: leagueChampion(teamIds, t.fixtures, results, names), table: standings(teamIds, t.fixtures, results, names), groups: null as GroupTable[] | null, byFixture, unscheduled: teamsWithoutFixtures(teamIds, t.fixtures) };
  }, [t, matches]);

  // 1.4.19: the owner (organizerId) is the tournament's only admin (core/tournamentAdmin); everyone else views only
  const isOrganizer = isTournamentAdmin(t, me.id);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (t && data?.champion && isOrganizer && t.status !== 'finished') backend.updateTournament(t.id, { status: 'finished' });
  }, [t, data?.champion, isOrganizer]);

  if (t === undefined) return <Loading />;
  if (!t || !data) return <Empty title={tr('tournament.notFound')} />;
  const teamOf = (tid: string | null) => t.teams.find((x) => x.id === tid);
  // 1.4.27 groups format: the knockout rounds come after the group rounds; R = the last group round
  const groupRounds = [...new Set(data.fixtures.filter((f) => f.group).map((f) => f.round))];
  const R = groupRounds.length ? Math.max(...groupRounds) : 0;
  const koRounds = [...new Set(data.fixtures.filter((f) => !f.group).map((f) => f.round))].sort((a, b) => a - b);
  const koTotal = koRounds.length;
  const koName = (round: number) => roundNameT(round - R, koTotal, tr);
  const byeOf = (f: Fixture) => (t.format === 'groups' ? !f.group && round1(f) && !!f.homeSeed !== !!f.awaySeed : isBye(f));
  const round1 = (f: Fixture) => f.round === R + 1;

  const start = async (f: Fixture) => {
    if (!f.homeId || !f.awayId) return;
    setStarting(f.id);
    setError(null);
    try {
      // Fixtures are played by the registered teams' current rosters; never by empty sides.
      const side = async (tid: string): Promise<{ mt: MatchTeam; captainId: string }> => {
        const tt = teamOf(tid)!;
        const team = await getOnce<Team | null>((cb) => backend.watchTeam(tid, cb));
        if (!team) throw new Error(tr('tournament.teamMissing', { team: tt.name }));
        const mt = await matchTeamFromTeam(team);
        if (mt.players.length < MIN_PLAYERS) throw new Error(tr('tournament.sideTooSmall', { team: team.name, min: MIN_PLAYERS }));
        return { mt, captainId: team.captainId };
      };
      const [sa, sb] = await Promise.all([side(f.homeId), side(f.awayId)]);
      const [a, b] = [sa.mt, sb.mt];
      const mid = await backend.createMatch(
        buildMatch({
          teamA: a,
          teamB: b,
          rules: t.rules,
          createdBy: me.id,
          scorerId: me.id,
          location: t.location,
          startNow: true,
          scheduledAt: Date.now(),
          title: f.group ? fixtureTitle(t.name, t.format, f.round, koTotal, f.group) : fixtureTitle(t.name, t.format, f.round - R, koTotal),
          tournamentId: t.id,
          fixtureId: f.id,
          captains: { A: sa.captainId, B: sb.captainId },
        }),
      );
      await backend.updateTournament(t.id, { fixtures: t.fixtures.map((x) => (x.id === f.id ? { ...x, matchId: mid } : x)) });
      router.push(`/match/${mid}/score`);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setStarting(null);
    }
  };

  const remove = async () => {
    if (!(await confirmAsk(tr('tournament.deleteConfirmBody'), { title: tr('tournament.deleteConfirmTitle'), confirmLabel: tr('tournament.delete'), cancelLabel: tr('tournament.deleteCancel') }))) return;
    setDeleting(true);
    setError(null);
    try {
      await backend.deleteTournament(t.id);
      router.back();
    } catch (e) {
      setError(translateError(e));
      setDeleting(false);
    }
  };

  // 1.5.0 (QA V1428-3): a team dot always has a contrasting ring (Day outline / Night light ring), so a dark team colour
  // stays visible on the navy Night cards
  const dot = (color: string | undefined, size: number, testID?: string) => (
    <View testID={testID} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? k.t.textMuted, marginRight: 6, borderWidth: 1.5, borderColor: k.day ? k.t.outline : k.t.text }} />
  );
  const FixtureCard = ({ f, compact, final }: { f: Fixture; compact?: boolean; final?: boolean }) => {
    const m = data.byFixture.get(f.id);
    const home = teamOf(f.homeId);
    const away = teamOf(f.awayId);
    const bye = byeOf(f);
    // 1.4.27: an open seeded slot shows its group place ("Group A #1") until the group is complete
    const seedOf = (side: 'home' | 'away') => (side === 'home' ? f.homeSeed : f.awaySeed);
    const open = (side: 'home' | 'away') => { const sd = seedOf(side); return sd ? tr('tournament.seed', { group: sd[0], place: sd.slice(1) }) : null; };
    const ready = !!home && !!away && !m && !bye;
    const winnerSide = m?.summary.winner;
    const line = (tt: typeof home, sets: number | undefined, win: boolean, side: 'home' | 'away') => (
      <Row style={{ marginVertical: 2 }}>
        {dot(tt?.color, 10)}
        <Body bold={win} size={14} color={tt ? k.t.text : k.t.textMuted} style={{ flex: 1 }} numberOfLines={1}>
          {tt?.name ?? open(side) ?? (bye ? tr('tournament.bye') : tr('tournament.tbd'))}
        </Body>
        {m && <Text style={[{ fontSize: 18, color: win ? (k.day ? k.t.text : k.t.primary) : k.t.text }, k.f.display]}>{sets}</Text>}
      </Row>
    );
    const press = m ? () => router.push(`/match/${m.id}`) : ready && isOrganizer && !starting ? () => start(f) : undefined;
    return (
      <Sticker
        style={[{ marginBottom: 10 }, compact && { width: BRACKET_CARD_W, marginRight: 10 }]}
        highlight={ready && isOrganizer}
        onPress={press}
        testID={`fixture-${f.id}`}
        inner={{ padding: 12 }}
      >
        {m?.status === 'live' && <View style={{ marginBottom: 4 }}><LivePill text={tr('common.live')} /></View>}
        {f.group ? <Body muted bold size={11}>{tr('tournament.group', { group: f.group })}</Body> : null}
        {line(home, m?.summary.setsA, winnerSide === 'A', 'home')}
        {line(away, m?.summary.setsB, winnerSide === 'B', 'away')}
        {ready && isOrganizer && <Body bold size={12} style={{ marginTop: 4 }}>{starting === f.id ? tr('tournament.starting') : tr('tournament.tapToStart')}</Body>}
        {bye && <Body muted bold size={12}>{tr('tournament.advances')}</Body>}
        {/* 1.5.0 (QA V1428-4): the final names its champion */}
        {final && m?.status === 'finished' && winnerSide ? (
          <Body bold size={12} style={{ marginTop: 4 }} testID={`fixture-champion-${f.id}`}>🏆 {tr('tournament.championShort', { team: (winnerSide === 'A' ? home : away)?.name ?? '' })}</Body>
        ) : null}
      </Sticker>
    );
  };

  // 1.4.27: one table renderer for the league table and every group table (the top `advance` rows are marked)
  const renderTable = (rows: StandingRow[], testID: string, advance = 0) => (
    <Sticker testID={testID} inner={{ padding: 10 }}>
      <Row style={{ paddingVertical: 4 }}>
        {['#', tr('tournament.colTeam'), tr('tournament.colPlayed'), tr('tournament.colWon'), tr('tournament.colLost'), tr('tournament.colSets'), tr('tournament.colPts')].map((h, i) => (
          <Text key={i} numberOfLines={1} style={[{ color: k.t.textMuted, fontSize: 12 }, k.f.bold, i === 1 ? { flex: 1 } : { width: i === 5 ? 44 : 28, textAlign: 'center' }]}>
            {h}
          </Text>
        ))}
      </Row>
      {rows.map((r, i) => {
        const tt = teamOf(r.teamId);
        const q = i < advance;
        return (
          <View key={r.teamId}>
            {k.day ? <View style={{ height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: k.t.outline, opacity: 0.3 }} /> : <View style={{ height: 1, backgroundColor: k.t.surface2 }} />}
            <Row style={{ paddingVertical: 10 }} testID={`table-row-${r.teamId}`}>
              <Text style={[{ width: 28, textAlign: 'center', color: k.t.text }, k.f.bold]}>{i + 1}</Text>
              {dot(tt?.color, 10, `table-dot-${r.teamId}`)}
              {/* 1.5.0 (QA V1428-2): long names wrap to 2 lines and shrink a little instead of being cut at 360 px; the
                  qualified badge is a separate pill with its own gap that never squeezes the name to nothing */}
              <Text testID={`table-name-${r.teamId}`} style={[{ flex: 1, flexShrink: 1, color: k.t.text, fontSize: 13, lineHeight: 17 }, k.f.bold]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>{tt?.name}</Text>
              {q ? (
                <View testID={`qualifies-${r.teamId}`} accessible accessibilityLabel={tr('tournament.qualifies')} style={{ marginLeft: 6, marginRight: 4, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8, borderWidth: 1, borderColor: k.day ? k.t.outline : k.t.text, flexShrink: 0 }}>
                  <Text style={[{ color: k.t.text, fontSize: 10, lineHeight: 15 }, k.f.bold]} numberOfLines={1}>{tr('tournament.qShort')}</Text>
                </View>
              ) : null}
              <Body style={{ width: 28, textAlign: 'center' }}>{r.played}</Body>
              <Body style={{ width: 28, textAlign: 'center' }}>{r.won}</Body>
              <Body style={{ width: 28, textAlign: 'center' }}>{r.lost}</Body>
              <Body style={{ width: 44, textAlign: 'center' }}>{r.setsWon}–{r.setsLost}</Body>
              <Text style={[{ width: 28, textAlign: 'center', fontSize: 20, color: k.day ? k.t.text : k.t.primary }, k.f.display]}>{r.tablePoints}</Text>
            </Row>
          </View>
        );
      })}
    </Sticker>
  );

  const rounds = [...new Set(data.fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const total = rounds.length;
  // Table only exists for a league, Bracket only for a knockout (spec shows all three on its league+playoff sample);
  // 1.4.27: groups + knockout has Groups (one table per group), Bracket (fed from the groups) and Fixtures
  const tabs: ('table' | 'groups' | 'bracket' | 'fixtures')[] = t.format === 'knockout' ? ['bracket', 'fixtures'] : t.format === 'groups' ? ['groups', 'bracket', 'fixtures'] : ['table', 'fixtures'];
  const roundLabel = (r: number) => (t.format === 'knockout' ? roundNameT(r, total, tr) : t.format === 'groups' ? (r <= R ? tr('tournament.groupRound', { n: r }) : koName(r)) : tr('tournament.round', { n: r }));
  const fmtKey = t.format === 'knockout' ? 'formats.knockout' : t.format === 'groups' ? 'formats.groups' : 'formats.league';
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const liveOrNext = data.fixtures.map((f) => ({ f, m: data.byFixture.get(f.id) })).find((x) => x.m && x.m.status === 'live');
  const next = liveOrNext && liveOrNext.m ? { f: liveOrNext.f, m: liveOrNext.m } : null;
  const liveRound = next ? roundLabel(next.f.round) : null;
  const heroInner = (fg: string) => (
    <>
      {liveRound ? <View style={{ marginBottom: 8 }}><LivePill text={`${tr('common.live')} · ${liveRound}`} /></View> : null}
      <Display size={30} color={fg} numberOfLines={3} accessibilityRole="header" style={breakWords}>{t.name}</Display>
      <Row style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <Ionicons name="calendar-outline" size={13} color={fg} />
        <Body size={12} color={fg}>{formatDateRangeT(t.startDate, t.endDate)}</Body>
        <Ionicons name="location-outline" size={13} color={fg} />
        <Body size={12} color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>{placeLabelT(t.location)}</Body>
      </Row>
      <Body size={12} color={fg} style={{ marginTop: 2 }}>{tr(fmtKey)} · {tr('tournaments.teams', { count: t.teams.length })}</Body>
      <Body size={11} color={fg} style={{ marginTop: 4, opacity: 0.9 }}>{describeRulesT(t.rules, tr)}</Body>
      {!isOrganizer && (
        <View testID="tournament-view-only" accessibilityLabel={`${tr('tournament.viewOnly')}. ${tr('tournament.viewOnlyHint')}`} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: k.day ? k.t.surface : k.t.surface2, borderWidth: k.day ? 2 : 0, borderColor: k.t.outline }}>
          <Text style={[{ color: k.t.text, fontSize: 12 }, k.f.bold]}>👁 {tr('tournament.viewOnly')}</Text>
        </View>
      )}
    </>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t.name }} />
      {/* 1.4.22 (spec v2 *-04 / *-18 / *-19): hero (Day teal sticker with a ball decor; Night title on a violet glow),
          segmented Table / Bracket / Fixtures, next-fixture card */}
      {k.day ? (
        <Sticker fill={k.t.teamB} style={{ marginBottom: 14 }} testID="tournament-hero" inner={{ padding: 18 }}>
          <Blob color={k.t.accent} size={110} style={{ top: -40, right: -30, borderWidth: 2, borderColor: k.t.outline }} />
          {heroInner(k.t.onTeamB)}
        </Sticker>
      ) : (
        <View style={{ marginBottom: 14, paddingVertical: 6 }} testID="tournament-hero">
          <Glow color={k.t.accent} size={260} style={{ top: -110, right: -100 }} opacity={0.5} />
          {heroInner(k.t.text)}
        </View>
      )}
      {!isOrganizer && <P muted style={{ marginBottom: 8 }}>{tr('tournament.viewOnlyHint')}</P>}
      {data.champion && (
        <Sticker fill={k.t.primary} style={{ marginBottom: 12 }} testID="tournament-champion" inner={{ padding: 14 }}>
          <Display size={20} color={k.t.onPrimary} style={{ textAlign: 'center' }}>{tr('tournament.champion', { team: teamOf(data.champion)?.name ?? '' })}</Display>
        </Sticker>
      )}
      {isOrganizer && !data.champion && <Banner text={tr('tournament.organiserBanner')} />}
      {data.unscheduled.length > 0 && (
        // 1.4.26 (E2E-5): a team added after the fixtures were made has none; no champion until it is resolved
        <Banner tone="warn" testID="tournament-unscheduled" text={tr('tournament.noFixturesWarn', { teams: data.unscheduled.map((x) => teamOf(x)?.name ?? x).join(', ') })} />
      )}
      {error && <Banner tone="warn" text={error} />}

      <View style={{ marginVertical: 10 }}>
        <SegmentedControl testID="tournament-tabs" items={tabs.map((key) => ({ key, label: tr(`dn.tab_${key}`) }))} value={current} onChange={setTab} />
      </View>

      {current === 'groups' && data.groups && (
        <View testID="tournament-groups">
          {data.groups.map((g) => (
            <View key={g.group} style={{ marginBottom: 14 }} testID={`group-${g.group}`}>
              <Over style={{ marginBottom: 6 }}>{tr('tournament.group', { group: g.group })}{g.complete ? ` · ${tr('tournament.groupDone')}` : ''}</Over>
              {renderTable(g.rows, `group-table-${g.group}`, t.advance ?? 2)}
            </View>
          ))}
          <Body muted size={12}>{tr('tournament.groupsHint', { count: t.advance ?? 2 })}</Body>
        </View>
      )}
      {current === 'table' && data.table && renderTable(data.table, 'tournament-table')}
      {current === 'table' && next ? (
        <>
          {!k.day ? <Display size={20} style={{ marginTop: 18, marginBottom: 8 }}>{tr('dn.nextFixture')}</Display> : null}
          <Sticker fill={k.day ? k.t.accent : k.t.surface} style={{ marginTop: k.day ? 16 : 0 }} onPress={() => router.push(`/match/${next.m.id}`)} testID="tournament-next" inner={{ padding: 14 }}>
            <Row style={{ gap: 8 }}>
              {next.m.status === 'live' ? <LivePill text={tr('common.live')} /> : null}
              <Body bold size={12} numberOfLines={1} style={{ flex: 1 }}>{k.day ? `${tr('dn.nextFixture')} · ` : ''}{roundLabel(next.f.round)}</Body>
            </Row>
            <Row style={{ marginTop: 8, gap: 8 }}>
              <Body bold size={14} numberOfLines={1} style={{ flex: 1 }}>{teamOf(next.f.homeId)?.name}</Body>
              <Text style={[{ fontSize: 26, color: k.day ? k.t.text : k.t.teamA }, k.f.display]}>{next.m.summary.currentA}</Text>
              <Text style={[{ fontSize: 22, color: k.t.text }, k.f.display]}>:</Text>
              <Text style={[{ fontSize: 26, color: k.day ? k.t.text : k.t.teamB }, k.f.display]}>{next.m.summary.currentB}</Text>
              <Body bold size={14} numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{teamOf(next.f.awayId)?.name}</Body>
            </Row>
          </Sticker>
        </>
      ) : null}

      {current === 'bracket' && (
        <>
        {(t.format === 'groups' ? koRounds : rounds).length > 1 ? (
          <Body muted size={12} style={{ marginBottom: 6 }} testID="bracket-scroll-hint">{tr('tournament.bracketScrollHint')}</Body>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator testID="tournament-bracket">
          {(t.format === 'groups' ? koRounds : rounds).map((r, ri, all) => (
            <View key={r} style={{ marginRight: 4 }}>
              <Over style={{ marginBottom: 6 }}>{roundLabel(r)}</Over>
              <View style={{ flex: 1, justifyContent: 'space-around' }}>
                {data.fixtures.filter((f) => f.round === r).map((f) => <FixtureCard key={f.id} f={f} compact final={ri === all.length - 1} />)}
              </View>
            </View>
          ))}
        </ScrollView>
        </>
      )}
      {current === 'fixtures' && (
        <View testID="tournament-fixtures">
          {rounds.map((r) => (
            <View key={r}>
              <Over style={{ marginBottom: 6, marginTop: 6 }}>{roundLabel(r)}</Over>
              {data.fixtures.filter((f) => f.round === r).map((f) => <FixtureCard key={f.id} f={f} />)}
            </View>
          ))}
        </View>
      )}
      {isOrganizer && (
        <Button testID="tournament-delete" title={tr('tournament.delete')} variant="danger" icon="trash-outline" loading={deleting} onPress={() => void remove()} style={{ marginTop: 18 }} />
      )}
    </Screen>
  );
}
