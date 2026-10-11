import { useLocalSearchParams } from 'expo-router';
import { firstFutureHour, isPastStart, localAt, localDayStart } from '../../core/dates';
import { LIMITS } from '../../core/limits';
import { pickFromTeam } from '../../core/challengeTeam';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { LocationPicker, placeReady } from '../../components/LocationPicker';
import { RulesEditor } from '../../components/RulesEditor';
import { KeyboardAwareScreen } from '../../components/KeyboardAwareScreen';
import { Banner, Button, Card, Chip, Field, H2, Loading, P, Row, styles as ui } from '../../components/ui';
import type { Place } from '../../core/geo';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import type { Team } from '../../core/types';
import { MIN_PLAYERS, teamCanPlay } from '../../core/roster';
import { backend } from '../../services/backend';
import { goBackOr } from '../../services/nav';
import { showToast } from '../../state/toast';
import { useMe } from '../../state/AuthContext';
import { useWatch } from '../../state/hooks';
import { formatDayChipT, hourLabel, translateError } from '../../i18n/format';
import { colors } from '../../theme';

const HOURS = [6, 7, 8, 9, 16, 17, 18, 19, 20];

export default function NewChallenge() {
  const { t: tr } = useTranslation();
  const me = useMe();
  const { fromTeamId } = useLocalSearchParams<{ fromTeamId: string }>();
  const myTeams = useWatch<Team[]>((cb) => backend.watchMyTeams(me.id, cb), [me.id]);
  const captained = (myTeams ?? []).filter((t) => t.captainId === me.id);
  const [chosen, setChosen] = useState<string | null>(null);
  const fromId = pickFromTeam(captained.map((t) => t.id), fromTeamId, chosen);
  const from = useWatch<Team | null>(fromId ? (cb) => backend.watchTeam(fromId, cb) : null, [fromId]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Team[]>([]);
  const [to, setTo] = useState<Team | null>(null);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(18);
  // Hours that are already over today can't be picked (QA G9/B2); "now" refreshes each render.
  const now = Date.now();
  const hourPast = (d: number, h: number) => d === 0 && isPastStart(localAt(0, h, now), now, 0);
  const pickDay = (d: number) => {
    setDay(d);
    if (hourPast(d, hour)) {
      const next = firstFutureHour(HOURS, d, now);
      if (next != null) setHour(next);
    }
  };
  const [location, setLocation] = useState<Place | null>(null);
  const [rules, setRules] = useState<RuleSet>({ ...INDOOR_RULES });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search; answers for an older query (or after leaving the screen) are dropped.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      backend
        .searchTeams(q)
        .then((r) => alive && setResults(r.filter((x) => x.id !== fromId)))
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, fromId]);
  // A stale error ("Pick where you want to play.") goes away as soon as the form changes.
  useEffect(() => setError(null), [to, location, day, hour]);

  if (myTeams === undefined) return <Loading />;
  if (captained.length === 0) return <Banner tone="warn" text={tr('challenge.onlyCaptain')} testID="only-captain" />;
  const teamChooser =
    captained.length > 1 ? (
      <Card>
        <Text style={ui.label}>{tr('challenge.pickFromTeam')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {captained.map((t) => (
            <Chip key={t.id} label={t.name} active={fromId === t.id} color={t.color} onPress={() => setChosen(t.id)} testID={`from-team-${t.id}`} />
          ))}
        </Row>
      </Card>
    ) : null;
  if (!fromId) return <KeyboardAwareScreen edges={[]}>{teamChooser}</KeyboardAwareScreen>;
  if (from === undefined) return <Loading />;
  if (!from || from.captainId !== me.id) return <Banner tone="warn" text={tr('challenge.onlyCaptain')} testID="only-captain" />;

  // Local calendar day + hour on this device (src/core/dates.ts; never UTC).
  const when = localAt(day, hour, now);

  const send = async () => {
    if (busy) return;
    if (!to) return setError(tr('challenge.pickTeam'));
    if (isPastStart(when, Date.now(), 0)) return setError(tr('errors.codes.time_in_past'));
    if (!location) return setError(tr('challenge.pickPlace'));
    if (!placeReady(location)) return setError(tr('location.nameRequired'));
    for (const team of [from, to]) if (!teamCanPlay(team)) return setError(tr('challenge.teamTooSmall', { team: team.name, min: MIN_PLAYERS }));
    setError(null);
    setBusy(true);
    try {
      await backend.createChallenge({
        fromTeamId: from.id,
        fromTeamName: from.name,
        fromCaptainId: me.id,
        toTeamId: to.id,
        toTeamName: to.name,
        toCaptainId: to.captainId,
        when,
        location: { ...location, name: location.name.trim() },
        message: message.trim(),
        rules,
      });
      setBusy(false);
      showToast(tr('challenge.sentToast', { team: to.name }));
      // Opened in a fresh tab there is no history: go to the team page instead (QA bug D).
      goBackOr(`/team/${from.id}`);
    } catch (e) {
      setError(translateError(e));
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScreen edges={[]}>
      {teamChooser}
      <P muted style={{ marginBottom: 12 }}>
        {tr('challenge.intro', { team: from.name })}
      </P>
      <Card>
        <Field label={tr('challenge.findTeam')} value={q} onChangeText={setQ} placeholder={tr('challenge.searchTeam')} maxLength={LIMITS.teamSearch.max} />
        <Row style={{ flexWrap: 'wrap' }}>
          {results.map((t) => (
            <Chip key={t.id} label={t.name} color={t.color} active={to?.id === t.id} onPress={() => setTo(t)} />
          ))}
        </Row>
        {results.length === 0 && <P muted>{tr('challenge.noTeams')}</P>}
      </Card>
      <Card>
        <Text style={ui.label}>{tr('challenge.day')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Chip
              key={d}
              label={d === 0 ? tr('common.today') : d === 1 ? tr('common.tomorrow') : formatDayChipT(localDayStart(d, now))}
              active={day === d}
              disabled={d === 0 && firstFutureHour(HOURS, 0, now) == null}
              onPress={() => pickDay(d)}
              testID={`challenge-day-${d}`}
            />
          ))}
        </Row>
        <Text style={ui.label}>{tr('challenge.time')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {HOURS.map((h) => (
            <Chip key={h} label={hourLabel(h, tr)} active={hour === h} disabled={hourPast(day, h)} onPress={() => setHour(h)} testID={`challenge-hour-${h}`} />
          ))}
        </Row>
      </Card>
      <H2>{tr('common.where')}</H2>
      <LocationPicker value={location} onChange={setLocation} />
      <Card>
        <RulesEditor value={rules} onChange={setRules} />
      </Card>
      <Field label={tr('challenge.message')} value={message} onChangeText={setMessage} placeholder={tr('challenge.messagePlaceholder')} maxLength={LIMITS.challengeMessage.max} multiline testID="challenge-message" />
      {error && <Text style={{ color: colors.danger, fontWeight: '700' }}>{error}</Text>}
      <Button title={tr('challenge.send')} icon="flash" big onPress={send} loading={busy} testID="send-challenge" />
    </KeyboardAwareScreen>
  );
}
