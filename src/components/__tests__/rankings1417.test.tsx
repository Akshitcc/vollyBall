/** 1.4.17 (QA V1416-2): Home's rankings refetch when one of my matches changes (confirm / repair / finish) and on focus. */
import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';

const mockFocusCbs: (() => void)[] = [];
jest.mock('expo-router', () => {
  const R = require('react');
  return { useFocusEffect: (cb: () => void) => R.useEffect(() => { mockFocusCbs.push(cb); cb(); }, [cb]) };
});
let mockPushMine: ((m: { id: string; updatedAt: number }[]) => void) | null = null;
const mockUnsub = jest.fn();
let mockCall = 0;
const mockGetRankings = jest.fn(async () => ({ me: { rank: ++mockCall, rankingPoints: 40 + mockCall }, ranked: [], total: 9, minMatches: 3 }));
jest.mock('../../services/backend', () => ({
  backend: {
    getRankings: (...a: unknown[]) => (mockGetRankings as (...x: unknown[]) => unknown)(...a),
    watchMyMatches: (_uid: string, cb: (m: { id: string; updatedAt: number }[]) => void) => { mockPushMine = cb; return mockUnsub; },
  },
}));
import { useMyRankings, myMatchesKey } from '../../state/useRankings';

function Probe() {
  const r = useMyRankings('me');
  return <Text testID="r">{r === undefined ? 'loading' : `${r?.me?.rank}:${r?.me?.rankingPoints}`}</Text>;
}

describe('V1416-2: useMyRankings (Home)', () => {
  it('refetches after a change to one of my matches and on focus; same data = no refetch', async () => {
    const s = await render(<Probe />);
    await act(async () => { mockPushMine!([{ id: 'm1', updatedAt: 1 }]); });
    const before = mockGetRankings.mock.calls.length;
    await act(async () => { mockPushMine!([{ id: 'm1', updatedAt: 1 }]); }); // same snapshot again
    expect(mockGetRankings.mock.calls.length).toBe(before);
    await act(async () => { mockPushMine!([{ id: 'm1', updatedAt: 2 }]); }); // the captain confirmed → updatedAt moves
    expect(mockGetRankings.mock.calls.length).toBe(before + 1);
    expect(s.getByTestId('r').props.children).toBe(`${mockCall}:${40 + mockCall}`);
    await act(async () => { mockFocusCbs[mockFocusCbs.length - 1](); }); // back to the Home tab
    expect(mockGetRankings.mock.calls.length).toBe(before + 2);
    await act(async () => { s.unmount(); });
    expect(mockUnsub).toHaveBeenCalled();
  });
  it('myMatchesKey follows id + updatedAt', () => {
    expect(myMatchesKey([{ id: 'a', updatedAt: 1 }])).not.toBe(myMatchesKey([{ id: 'a', updatedAt: 2 }]));
    expect(myMatchesKey(null)).toBe('');
  });
});
