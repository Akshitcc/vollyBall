import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { Banner, Button, Empty, Loading, P, Row, Screen, breakWords } from '../../components/ui';
import { fixtureResultFromMatch } from '../../core/results';
import { fixtureTitle, isBye, leagueChampion, resolveKnockout, standings, type Fixture, type FixtureResult } from '../../core/tournament';
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
  const [tab, setTab] = useState<'table' | 'bracket' | 'fixtures' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!t) return null;
    const results: FixtureResult[] = matches.map(fixtureResultFromMatch).filter((r): r is FixtureResult => !!r);
    const byFixture = new Map(matches.filter((m) => m.fixtureId).map((m) => [m.fixtureId!, m]));
    const teamIds = t.teams.map((x) => x.id);
    if (t.format === 'knockout') {
      const ko = resolveKnockout(t.fixtures, results);
      return { fixtures: ko.fixtures, champion: ko.championId, table: null, byFixture };
    }
    return { fixtures: t.fixtures, champion: leagueChampion(teamIds, t.fixtures, results), table: standings(teamIds, t.fixtures, results), byFixture };
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
          title: fixtureTitle(t.name, t.format, f.round, Math.max(...t.fixtures.map((x) => x.round))),
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

  const FixtureCard = ({ f, compact }: { f: Fixture; compact?: boolean }) => {
    const m = data.byFixture.get(f.id);
    const home = teamOf(f.homeId);
    const away = teamOf(f.awayId);
    const bye = isBye(f);
    const ready = !!home && !!away && !m && !bye;
    const winnerSide = m?.summary.winner;
    const line = (tt: typeof home, sets: number | undefined, win: boolean) => (
      <Row style={{ marginVertical: 2 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tt?.color ?? k.t.textMuted, marginRight: 6, borderWidth: k.day ? 1.5 : 0, borderColor: k.t.outline }} />
        <Body bold={win} size={14} color={tt ? k.t.text : k.t.textMuted} style={{ flex: 1 }} numberOfLines={1}>
          {tt?.name ?? (bye ? tr('tournament.bye') : tr('tournament.tbd'))}
        </Body>
        {m && <Text style={[{ fontSize: 18, color: win ? (k.day ? k.t.text : k.t.primary) : k.t.text }, k.f.display]}>{sets}</Text>}
      </Row>
    );
    const press = m ? () => router.push(`/match/${m.id}`) : ready && isOrganizer && !starting ? () => start(f) : undefined;
    return (
      <Sticker
        style={[{ marginBottom: 10 }, compact && { width: 210, marginRight: 10 }]}
        highlight={ready && isOrganizer}
        onPress={press}
        testID={`fixture-${f.id}`}
        inner={{ padding: 12 }}
      >
        {m?.status === 'live' && <View style={{ marginBottom: 4 }}><LivePill text={tr('common.live')} /></View>}
        {line(home, m?.summary.setsA, winnerSide === 'A')}
        {line(away, m?.summary.setsB, winnerSide === 'B')}
        {ready && isOrganizer && <Body bold size={12} style={{ marginTop: 4 }}>{starting === f.id ? tr('tournament.starting') : tr('tournament.tapToStart')}</Body>}
        {bye && <Body muted bold size={12}>{tr('tournament.advances')}</Body>}
      </Sticker>
    );
  };

  const rounds = [...new Set(data.fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const total = rounds.length;
  // Table only exists for a league, Bracket only for a knockout (spec shows all three on its league+playoff sample)
  const tabs: ('table' | 'bracket' | 'fixtures')[] = t.format === 'knockout' ? ['bracket', 'fixtures'] : ['table', 'fixtures'];
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const liveOrNext = data.fixtures.map((f) => ({ f, m: data.byFixture.get(f.id) })).find((x) => x.m && x.m.status === 'live');
  const next = liveOrNext && liveOrNext.m ? { f: liveOrNext.f, m: liveOrNext.m } : null;
  const liveRound = next ? roundNameT(next.f.round, total, tr) : null;
  const heroInner = (fg: string) => (
    <>
      {liveRound ? <View style={{ marginBottom: 8 }}><LivePill text={`${tr('common.live')} · ${liveRound}`} /></View> : null}
      <Display size={30} color={fg} numberOfLines={3} accessibilityRole="header" style={breakWords}>{t.name}</Display>
      <Row style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <Ionicons name="calendar-outline" size={13} color={fg} />
        <Body size={12} color={fg}>{formatDateRangeT(t.startDate, t.endDate)}</Body>
        <Ionicons name="location-outline" size={13} color={fg} />
        <Body size={12} color={fg} numberOfLines={1} style={{ flexShrink: 1 }}>{t.location.name}</Body>
      </Row>
      <Body size={12} color={fg} style={{ marginTop: 2 }}>{tr(t.format === 'knockout' ? 'formats.knockout' : 'formats.league')} · {tr('tournaments.teams', { count: t.teams.length })}</Body>
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
      {error && <Banner tone="warn" text={error} />}

      <View style={{ marginVertical: 10 }}>
        <SegmentedControl testID="tournament-tabs" items={tabs.map((key) => ({ key, label: tr(`dn.tab_${key}`) }))} value={current} onChange={setTab} />
      </View>

      {current === 'table' && data.table && (
        <Sticker testID="tournament-table" inner={{ padding: 10 }}>
          <Row style={{ paddingVertical: 4 }}>
            {['#', tr('tournament.colTeam'), tr('tournament.colPlayed'), tr('tournament.colWon'), tr('tournament.colLost'), tr('tournament.colSets'), tr('tournament.colPts')].map((h, i) => (
              <Text key={i} numberOfLines={1} style={[{ color: k.t.textMuted, fontSize: 12 }, k.f.bold, i === 1 ? { flex: 1 } : { width: i === 5 ? 44 : 28, textAlign: 'center' }]}>
                {h}
              </Text>
            ))}
          </Row>
          {data.table.map((r, i) => {
            const tt = teamOf(r.teamId);
            return (
              <View key={r.teamId}>
                {k.day ? <View style={{ height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: k.t.outline, opacity: 0.3 }} /> : <View style={{ height: 1, backgroundColor: k.t.surface2 }} />}
                <Row style={{ paddingVertical: 10 }} testID={`table-row-${r.teamId}`}>
                  <Text style={[{ width: 28, textAlign: 'center', color: k.t.text }, k.f.bold]}>{i + 1}</Text>
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tt?.color ?? k.t.textMuted, marginRight: 6, borderWidth: k.day ? 1.5 : 0, borderColor: k.t.outline }} />
                  <Text style={[{ flex: 1, color: k.t.text, fontSize: 14 }, k.f.bold]} numberOfLines={1}>{tt?.name}</Text>
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
      )}

      {current === 'table' && next ? (
        <>
          {!k.day ? <Display size={20} style={{ marginTop: 18, marginBottom: 8 }}>{tr('dn.nextFixture')}</Display> : null}
          <Sticker fill={k.day ? k.t.accent : k.t.surface} style={{ marginTop: k.day ? 16 : 0 }} onPress={() => router.push(`/match/${next.m.id}`)} testID="tournament-next" inner={{ padding: 14 }}>
            <Row style={{ gap: 8 }}>
              {next.m.status === 'live' ? <LivePill text={tr('common.live')} /> : null}
              <Body bold size={12} numberOfLines={1} style={{ flex: 1 }}>{k.day ? `${tr('dn.nextFixture')} · ` : ''}{roundNameT(next.f.round, total, tr)}</Body>
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="tournament-bracket">
          {rounds.map((r) => (
            <View key={r} style={{ marginRight: 4 }}>
              <Over style={{ marginBottom: 6 }}>{roundNameT(r, total, tr)}</Over>
              <View style={{ flex: 1, justifyContent: 'space-around' }}>
                {data.fixtures.filter((f) => f.round === r).map((f) => <FixtureCard key={f.id} f={f} compact />)}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      {current === 'fixtures' && (
        <View testID="tournament-fixtures">
          {rounds.map((r) => (
            <View key={r}>
              <Over style={{ marginBottom: 6, marginTop: 6 }}>{t.format === 'knockout' ? roundNameT(r, total, tr) : tr('tournament.round', { n: r })}</Over>
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
