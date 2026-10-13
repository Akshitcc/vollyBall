/**
 * 1.4.19: V1417-3 (fast Enter bursts are queued; the field is cleared once per Enter and never written later),
 * V1416-3 / V1418-2 (the +91 field is revealed on open and after every add, 6th to 12th).
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import React, { useState } from 'react';
import { TeamBuilder, type BuiltTeam } from '../TeamBuilder';
import { ScrollRevealContext } from '../KeyboardAwareScreen';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockLookups: string[] = [];
jest.mock('../../services/backend', () => ({
  backend: {
    findUserByPhone: (n: string) => {
      mockLookups.push(n);
      return new Promise((res) => setTimeout(() => res(n.endsWith('99') ? null : { id: `u${n.slice(-2)}`, name: `Player ${n.slice(-2)}`, photoURL: null }), 30));
    },
  },
}));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

const reveals: unknown[] = [];
function Harness({ start = 0 }: { start?: number }) {
  const [v, setV] = useState<BuiltTeam>({ kind: 'build', name: 'QA', color: '#E53935', players: Array.from({ length: start }, (_, i) => ({ id: `p${i}`, name: `P${i}`, photoURL: null })) });
  return (
    <ScrollRevealContext.Provider value={(node) => reveals.push(node)}>
      <TeamBuilder value={v} onChange={setV} otherPlayerIds={[]} testID="side-a" max={12} />
    </ScrollRevealContext.Provider>
  );
}
const tick = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
beforeEach(() => { mockLookups.length = 0; reveals.length = 0; });

describe('V1417-3: fast Enter bursts', () => {
  it('…11, …12, …13, …14 back to back: all four added in order, field empty, nothing written late', async () => {
    const s = await render(<Harness />);
    const f = () => s.getByTestId('side-a-phone');
    for (const d of ['11', '12', '13', '14']) {
      await fireEvent.changeText(f(), `90000000${d}`);
      await fireEvent(f(), 'submitEditing');
      expect(f().props.value).toBe('');
    }
    await fireEvent.changeText(f(), '98'); // the next number being typed
    await tick(300);
    expect(['11', '12', '13', '14'].map((d) => !!s.queryByText(`Player ${d}`))).toEqual([true, true, true, true]);
    expect(s.getByText(/4\/12/)).toBeTruthy();
    const names = s.getAllByText(/^Player 1\d$/).map((n) => n.props.children);
    expect(names).toEqual(['Player 11', 'Player 12', 'Player 13', 'Player 14']); // in order
    expect(f().props.value).toBe('98');
    expect(new Set(mockLookups).size).toBe(mockLookups.length); // one lookup per number
  });
  it('a refused number in the burst says why and the rest still go in', async () => {
    const s = await render(<Harness />);
    const f = () => s.getByTestId('side-a-phone');
    for (const d of ['11', '99', '11', '12']) {
      await fireEvent.changeText(f(), `90000000${d}`);
      await fireEvent(f(), 'submitEditing');
    }
    await tick(300);
    expect(s.getAllByText('Player 11')).toHaveLength(1);
    expect(s.getByText('Player 12')).toBeTruthy();
    expect(f().props.value).toBe('');
  });
  it('an incomplete number: Enter keeps it', async () => {
    const s = await render(<Harness />);
    await fireEvent.changeText(s.getByTestId('side-a-phone'), '90000');
    await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
    expect(s.getByTestId('side-a-phone').props.value).toBe('90000');
  });
});

describe('V1416-3 / V1418-2: the +91 field is revealed', () => {
  it('on open, without focus', async () => {
    await render(<Harness />);
    await tick(450);
    expect(reveals.length).toBeGreaterThan(0);
  });
  it('after each add from the 6th to the 12th', async () => {
    const s = await render(<Harness start={5} />);
    await tick(1000);
    for (let i = 0; i < 7; i++) {
      reveals.length = 0;
      await fireEvent.changeText(s.getByTestId('side-a-phone'), `90000000${20 + i}`);
      await fireEvent(s.getByTestId('side-a-phone'), 'submitEditing');
      await tick(500);
      if (i < 6) expect([i, reveals.length > 0]).toEqual([i, true]);
    }
    expect(s.getByTestId('side-a-full')).toBeTruthy();
  });
});
