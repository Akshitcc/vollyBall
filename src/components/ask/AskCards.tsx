/**
 * 1.5.0 Ask VolleyLive rich cards: scoreboard, standings table, stat card, fixtures list, roster and a simple list.
 * Built for 360 px wide phones: full-width stickers, names wrap to 2 lines, numbers in fixed narrow columns. Day/Night
 * via useTheme().t (the DNKit), EN/HI via i18n. Cards only show public data (they come from the read-only tools).
 */
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Body, LivePill, Sticker, useKit } from '../DNKit';
import type { AskCard, FixturesCard, ListCard, RosterCard, ScoreboardCard, StandingsCard, StatCard } from '../../core/ask/cards';

const NUM_W = 26;

function Dot({ color }: { color: string }) {
  const { t, day } = useKit();
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginRight: 6, borderWidth: 1.5, borderColor: day ? t.outline : t.text }} />;
}
function Title({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return <Body bold size={13} numberOfLines={2} style={{ marginBottom: 6 }} testID={testID}>{children}</Body>;
}

function Scoreboard({ c }: { c: ScoreboardCard }) {
  const { t, f } = useKit();
  const { t: tr } = useTranslation();
  const line = (name: string, color: string, sets: number, cur: number, win: boolean, side: 'A' | 'B') => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 3 }} testID={`ask-score-${c.matchId}-${side}`}>
      <Dot color={color} />
      <Text style={[{ flex: 1, color: t.text, fontSize: 14 }, win ? f.bold : null]} numberOfLines={2}>{name}</Text>
      <Text style={[{ width: NUM_W, textAlign: 'center', color: t.text, fontSize: 18 }, f.bold]}>{sets}</Text>
      {c.status === 'live' ? <Text style={[{ width: NUM_W + 6, textAlign: 'center', color: t.textMuted, fontSize: 14 }, f.bold]}>{cur}</Text> : null}
    </View>
  );
  return (
    <Sticker testID={`ask-card-scoreboard-${c.matchId}`} onPress={() => router.push(`/match/${c.matchId}`)} accessibilityLabel={`${c.teamA.name} ${c.setsA}, ${c.teamB.name} ${c.setsB}`} inner={{ padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 }}>
        {c.status === 'live' ? <LivePill text={tr('ask.card.live')} /> : <Body muted bold size={11}>{tr(`ask.card.status.${c.status}`)}</Body>}
        {c.title ? <Body muted size={11} numberOfLines={1} style={{ flex: 1 }}>{c.title}</Body> : null}
      </View>
      {line(c.teamA.name, c.teamA.color, c.setsA, c.currentA, c.winner === 'A', 'A')}
      {line(c.teamB.name, c.teamB.color, c.setsB, c.currentB, c.winner === 'B', 'B')}
      {c.sets.length ? <Body muted size={11} style={{ marginTop: 4 }}>{c.sets.map(([a, b]) => `${a}–${b}`).join(' · ')}</Body> : null}
    </Sticker>
  );
}

function Standings({ c }: { c: StandingsCard }) {
  const { t, f, day } = useKit();
  const { t: tr } = useTranslation();
  const head = ['#', tr('tournament.colTeam'), tr('tournament.colPlayed'), tr('tournament.colWon'), tr('tournament.colLost'), tr('tournament.colPts')];
  return (
    <Sticker testID={`ask-card-standings-${c.tournamentId}${c.group ? `-${c.group}` : ''}`} onPress={() => router.push(`/tournament/${c.tournamentId}`)} inner={{ padding: 10 }}>
      <Title>{c.title}{c.group ? ` · ${tr('ask.card.group', { group: c.group })}` : ''}</Title>
      {c.champion ? <Body bold size={12} style={{ marginBottom: 4 }} testID={`ask-card-champion-${c.tournamentId}`}>{tr('ask.card.champion', { team: c.champion })}</Body> : null}
      <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
        {head.map((h, i) => <Text key={i} numberOfLines={1} style={[{ color: t.textMuted, fontSize: 11 }, f.bold, i === 1 ? { flex: 1 } : { width: i === 0 ? 20 : NUM_W, textAlign: 'center' }]}>{h}</Text>)}
      </View>
      {c.rows.map((r) => (
        <View key={r.teamId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderColor: day ? t.outline + '44' : t.surface2 }} testID={`ask-standings-row-${r.teamId}`}>
          <Text style={[{ width: 20, textAlign: 'center', color: t.text, fontSize: 12 }, f.bold]}>{r.pos}</Text>
          <Dot color={r.color} />
          <Text style={[{ flex: 1, color: t.text, fontSize: 13 }, f.bold]} numberOfLines={2}>{r.name}</Text>
          {r.q ? <Text style={[{ color: t.text, fontSize: 10, marginHorizontal: 4, paddingHorizontal: 4, borderWidth: 1, borderRadius: 6, borderColor: day ? t.outline : t.text }, f.bold]}>{tr('ask.card.q')}</Text> : null}
          {[r.played, r.won, r.lost].map((v, i) => <Text key={i} style={{ width: NUM_W, textAlign: 'center', color: t.text, fontSize: 12 }}>{v}</Text>)}
          <Text style={[{ width: NUM_W, textAlign: 'center', color: t.text, fontSize: 14 }, f.bold]}>{r.points}</Text>
        </View>
      ))}
    </Sticker>
  );
}

function Stat({ c }: { c: StatCard }) {
  const { t, f } = useKit();
  const { t: tr } = useTranslation();
  const cells: [string, string][] = [
    [tr('ask.card.rank'), c.rank ? `#${c.rank}` : '—'], [tr('ask.card.played'), String(c.matches)], [tr('ask.card.won'), String(c.wins)],
    [tr('ask.card.winPct'), `${c.winPct}%`], [tr('ask.card.points'), String(c.rankingPoints)], [tr('ask.card.potm'), String(c.potm)],
  ];
  return (
    <Sticker testID={`ask-card-stat-${c.playerId}`} inner={{ padding: 12 }}>
      <Title>{c.mine ? `${c.name} (${tr('ask.card.you')})` : c.name}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
        {cells.map(([k, v]) => (
          <View key={k} style={{ width: '31%', minWidth: 84 }} accessible accessibilityLabel={`${k}: ${v}`}>
            <Text style={[{ color: t.text, fontSize: 18 }, f.bold]} numberOfLines={1}>{v}</Text>
            <Text style={{ color: t.textMuted, fontSize: 11 }} numberOfLines={1}>{k}</Text>
          </View>
        ))}
      </View>
      {!c.rank ? <Body muted size={11} style={{ marginTop: 6 }}>{tr('ask.card.notRanked')}</Body> : null}
    </Sticker>
  );
}

function Fixtures({ c }: { c: FixturesCard }) {
  const { t, f, day } = useKit();
  const { t: tr } = useTranslation();
  return (
    <Sticker testID="ask-card-fixtures" inner={{ padding: 10 }}>
      <Title>{c.title}</Title>
      {c.items.map((i) => (
        <View key={i.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderColor: day ? t.outline + '44' : t.surface2 }} testID={`ask-fixture-${i.id}`}>
          {i.label ? <Text style={{ color: t.textMuted, fontSize: 11 }} numberOfLines={1}>{i.label}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[{ flex: 1, color: t.text, fontSize: 13 }, f.bold]} numberOfLines={2} onPress={i.matchId ? () => router.push(`/match/${i.matchId}`) : undefined}>
              {i.home} {tr('ask.card.vs')} {i.away}
            </Text>
            <Text style={[{ minWidth: 52, textAlign: 'right', color: t.text, fontSize: 12 }, f.bold]}>
              {i.status === 'finished' || i.status === 'live' ? `${i.setsA ?? 0}–${i.setsB ?? 0}` : tr(`ask.card.status.${i.status}`)}
            </Text>
          </View>
          {/* 1.5.1 (Tester F150-7): a finished result's state – a voided / disputed / pending one is never shown as plain */}
          {i.status === 'finished' && i.result ? <Text style={{ color: t.textMuted, fontSize: 11 }} numberOfLines={2} testID={`ask-fixture-result-${i.id}`}>{tr(`ask.card.result.${i.result}`)}</Text> : null}
        </View>
      ))}
    </Sticker>
  );
}

function Roster({ c }: { c: RosterCard }) {
  const { t } = useKit();
  const { t: tr } = useTranslation();
  return (
    <Sticker testID={`ask-card-roster-${c.teamId}`} onPress={() => router.push(`/team/${c.teamId}`)} inner={{ padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Dot color={c.color} /><Body bold size={14} numberOfLines={2} style={{ flex: 1 }}>{c.name}</Body></View>
      <Body muted size={11} style={{ marginBottom: 4 }}>{tr('ask.card.players', { count: c.players.length })}</Body>
      {c.players.map((p) => (
        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
          <Text style={{ flex: 1, color: t.text, fontSize: 13 }} numberOfLines={1}>{p.name}</Text>
          {p.captain ? <Body bold size={11}>{tr('ask.card.captain')}</Body> : p.sub ? <Body muted size={11}>{tr('ask.card.sub')}</Body> : null}
        </View>
      ))}
    </Sticker>
  );
}

function List({ c }: { c: ListCard }) {
  const { t, f, day } = useKit();
  const { t: tr } = useTranslation();
  const go = (id: string) => (c.kind === 'teams' ? () => router.push(`/team/${id}`) : c.kind === 'tournaments' ? () => router.push(`/tournament/${id}`) : undefined);
  const value = (v: string | null | undefined) => (!v ? null : c.kind === 'challenges' ? tr(`ask.card.status.${v}`, { defaultValue: v }) : c.kind === 'teams' && v === 'captain' ? tr('ask.card.captainOf') : v);
  return (
    <Sticker testID={`ask-card-list-${c.kind}`} inner={{ padding: 10 }}>
      <Title>{tr(`ask.card.kind.${c.kind}`)}</Title>
      {c.items.map((i) => (
        <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: day ? t.outline + '44' : t.surface2 }} testID={`ask-list-${c.kind}-${i.id}`}>
          <View style={{ flex: 1 }}>
            <Text style={[{ color: t.text, fontSize: 13 }, i.mine ? f.bold : null]} numberOfLines={2} onPress={go(i.id)}>{i.title}{i.mine && c.kind === 'leaderboard' ? ` (${tr('ask.card.you')})` : ''}</Text>
            {i.subtitle ? <Text style={{ color: t.textMuted, fontSize: 11 }} numberOfLines={1}>{c.kind === 'teams' && /^\d+$/.test(i.subtitle) ? tr('ask.card.players', { count: Number(i.subtitle) }) : i.subtitle}</Text> : null}
          </View>
          {value(i.value) ? <Text style={[{ color: t.text, fontSize: 12, marginLeft: 8 }, f.bold]} numberOfLines={1}>{value(i.value)}</Text> : null}
        </View>
      ))}
    </Sticker>
  );
}

export function AskCardView({ card }: { card: AskCard }) {
  switch (card.type) {
    case 'scoreboard': return <Scoreboard c={card} />;
    case 'standings': return <Standings c={card} />;
    case 'stat': return <Stat c={card} />;
    case 'fixtures': return <Fixtures c={card} />;
    case 'roster': return <Roster c={card} />;
    case 'list': return <List c={card} />;
    default: return null;
  }
}
export function AskCards({ cards, testID }: { cards: readonly AskCard[]; testID?: string }) {
  if (!cards.length) return null;
  return <View style={{ gap: 10, marginTop: 8 }} testID={testID}>{cards.map((c, i) => <AskCardView key={i} card={c} />)}</View>;
}
