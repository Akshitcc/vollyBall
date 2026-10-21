/** 1.4.27 (E2E-10, Tester's 1.4.26 browser pass, match_5mc8xbgv9y0x): an old tap-a-player match (players credited,
 * no point kinds) shows a dash for Spikes / Blocks / Aces – decided from the data, no new flag. */
import { render } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import { hasDetailedStats } from '../../core/stats';
import type { MatchEvent } from '../../core/scoring';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../services/backend', () => ({ backend: {} }));
const { PotmBadge, POTM_NO_STATS } = require('../Potm');

const rules = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 5, winBy: 1, pointCap: null };
const pl = (id: string) => ({ id, name: `${id.toUpperCase()} Player`, photoURL: null });
const match = (events: MatchEvent[]): Match => ({
  id: 'match_5mc8xbgv9y0x', title: 'Old', status: 'finished', rules, firstServe: 'A', events, playerOfMatchId: 'a1',
  teamA: { name: 'Spikers', color: '#D93636', players: [pl('a1'), pl('a2')] }, teamB: { name: 'Blockers', color: '#001F4D', players: [pl('b1'), pl('b2')] },
  createdBy: 'a1', scorerId: 'a1', participantIds: ['a1', 'a2', 'b1', 'b2'], createdAt: 1, updatedAt: 1, summary: { setsA: 1, setsB: 0, winner: 'A' },
}) as unknown as Match;
const tiles = (r: Awaited<ReturnType<typeof render>>) => r.getByTestId('potm-badge');

it('tap-a-player only (no kinds): points shown, Spikes / Blocks / Aces are a dash', async () => {
  const ev = Array.from({ length: 5 }, (_, i) => ({ type: 'point', side: 'A', at: i, playerId: i % 2 ? 'a2' : 'a1' }) as MatchEvent);
  expect(hasDetailedStats(ev)).toBe(false);
  const r = await render(<PotmBadge match={match(ev)} />);
  expect(tiles(r)).toHaveTextContent(/3 pts.*3.*–.*–.*–/);
  expect(r.getAllByText(POTM_NO_STATS)).toHaveLength(3);
});
it('detailed stats recorded: real numbers, zeros included', async () => {
  const ev = Array.from({ length: 5 }, (_, i) => ({ type: 'point', side: 'A', at: i, playerId: 'a1', kind: i === 0 ? 'ace' : 'kill' }) as MatchEvent);
  expect(hasDetailedStats(ev)).toBe(true);
  const r = await render(<PotmBadge match={match(ev)} />);
  expect(r.queryAllByText(POTM_NO_STATS)).toHaveLength(0);
  expect(tiles(r)).toHaveTextContent(/5.*4.*0.*1/);
});
