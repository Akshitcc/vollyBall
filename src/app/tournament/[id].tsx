import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { Banner, Card, Empty, H2, Loading, P, Row, Screen, breakWords } from '../../components/ui';
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

export default function TournamentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t: tr } = useTranslation();
  const me = useMe();
  const t = useWatch<Tournament | null>((cb) => backend.watchTournament(id, cb), [id]);
  const matches = useWatch<Match[]>((cb) => backend.watchTournamentMatches(id, cb), [id]) ?? [];
  const [starting, setStarting] = useState<string | null>(null);
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

  const isOrganizer = t?.organizerId === me.id;
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

  const FixtureCard = ({ f, compact }: { f: Fixture; compact?: boolean }) => {
    const m = data.byFixture.get(f.id);
    const home = teamOf(f.homeId);
    const away = teamOf(f.awayId);
    const bye = isBye(f);
    const ready = !!home && !!away && !m && !bye;
    const winnerSide = m?.summary.winner;
    const line = (tt: typeof home, sets: number | undefined, win: boolean) => (
      <Row style={{ marginVertical: 2 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tt?.color ?? colors.border, marginRight: 6 }} />
        <Text style={{ flex: 1, fontWeight: win ? '900' : '700', color: tt ? colors.text : colors.muted }} numberOfLines={1}>
          {tt?.name ?? (bye ? tr('tournament.bye') : tr('tournament.tbd'))}
        </Text>
        {m && <Text style={{ fontWeight: '900', fontSize: 16 }}>{sets}</Text>}
      </Row>
    );
    return (
      <Card
        style={[compact && { width: 210, marginRight: 10 }, ready && isOrganizer && { borderColor: colors.primaryText, borderWidth: 2 }]}
        onPress={m ? () => router.push(`/match/${m.id}`) : ready && isOrganizer && !starting ? () => start(f) : undefined}
      >
        {m?.status === 'live' && <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 11 }}>{tr('tournament.live')}</Text>}
        {line(home, m?.summary.setsA, winnerSide === 'A')}
        {line(away, m?.summary.setsB, winnerSide === 'B')}
        {ready && isOrganizer && <Text style={{ color: colors.ink, fontWeight: '900', fontSize: 12, marginTop: 4 }}>{starting === f.id ? tr('tournament.starting') : tr('tournament.tapToStart')}</Text>}
        {bye && <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>{tr('tournament.advances')}</Text>}
      </Card>
    );
  };

  const rounds = [...new Set(data.fixtures.map((f) => f.round))].sort((a, b) => a - b);
  const total = rounds.length;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: t.name }} />
      <View style={{ backgroundColor: colors.ink, borderRadius: 18, padding: 18, marginBottom: 12 }}>
        <Text style={[font.h2, { color: colors.white }, breakWords]} numberOfLines={3} ellipsizeMode="tail">🏆 {t.name}</Text>
        <Text style={{ color: colors.onInkMuted, fontWeight: '700', marginTop: 4 }}>
          {tr(t.format === 'knockout' ? 'formats.knockout' : 'formats.league')} · {tr('tournaments.teams', { count: t.teams.length })} · {formatDateRangeT(t.startDate, t.endDate)}
        </Text>
        <Text style={{ color: colors.onInkMuted, fontWeight: '600', marginTop: 2 }}>📍 {t.location.name}</Text>
        <Text style={{ color: colors.onInkMuted, fontSize: 12, marginTop: 6 }}>{describeRulesT(t.rules, tr)}</Text>
      </View>
      {data.champion && (
        <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
          <Text style={[font.h2, { textAlign: 'center', color: colors.ink }]}>{tr('tournament.champion', { team: teamOf(data.champion)?.name ?? '' })}</Text>
        </Card>
      )}
      {isOrganizer && !data.champion && <Banner text={tr('tournament.organiserBanner')} />}
      {error && <Banner tone="warn" text={error} />}

      {data.table && (
        <>
          <H2>{tr('tournament.table')}</H2>
          <Card style={{ padding: 10 }}>
            <Row style={{ paddingVertical: 4 }}>
              {[tr('tournament.colPos'), tr('tournament.colTeam'), tr('tournament.colPlayed'), tr('tournament.colWon'), tr('tournament.colLost'), tr('tournament.colSets'), tr('tournament.colPts')].map((h, i) => (
                <Text key={i} numberOfLines={1} style={[{ fontWeight: '900', color: colors.muted, fontSize: 12 }, i === 1 ? { flex: 1 } : { width: i === 5 ? 44 : 28, textAlign: 'center' }]}>
                  {h}
                </Text>
              ))}
            </Row>
            {data.table.map((r, i) => (
              <Row key={r.teamId} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.divider }}>
                <Text style={{ width: 28, textAlign: 'center', fontWeight: '900' }}>{i + 1}</Text>
                <Text style={{ flex: 1, fontWeight: '800' }} numberOfLines={1}>
                  {teamOf(r.teamId)?.name}
                </Text>
                <Text style={{ width: 28, textAlign: 'center' }}>{r.played}</Text>
                <Text style={{ width: 28, textAlign: 'center' }}>{r.won}</Text>
                <Text style={{ width: 28, textAlign: 'center' }}>{r.lost}</Text>
                <Text style={{ width: 44, textAlign: 'center' }}>
                  {r.setsWon}-{r.setsLost}
                </Text>
                <Text style={{ width: 28, textAlign: 'center', fontWeight: '900', color: colors.ink }}>{r.tablePoints}</Text>
              </Row>
            ))}
          </Card>
        </>
      )}

      <H2>{t.format === 'knockout' ? tr('tournament.bracket') : tr('tournament.fixtures')}</H2>
      {t.format === 'knockout' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {rounds.map((r) => (
            <View key={r} style={{ marginRight: 4 }}>
              <Text style={[font.small, { color: colors.muted, marginBottom: 6, textTransform: 'uppercase' }]}>{roundNameT(r, total, tr)}</Text>
              <View style={{ flex: 1, justifyContent: 'space-around' }}>
                {data.fixtures
                  .filter((f) => f.round === r)
                  .map((f) => (
                    <FixtureCard key={f.id} f={f} compact />
                  ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        rounds.map((r) => (
          <View key={r}>
            <P muted style={{ fontWeight: '800', marginBottom: 4 }}>{tr('tournament.round', { n: r })}</P>
            {data.fixtures
              .filter((f) => f.round === r)
              .map((f) => (
                <FixtureCard key={f.id} f={f} />
              ))}
          </View>
        ))
      )}
    </Screen>
  );
}
