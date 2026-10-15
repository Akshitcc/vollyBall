/** 1.4.21 (QA V1420-5) rendered TeamBuilder: queued numbers listed, refused ones with reason + Dismiss.
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

const NR = 'This number isn’t on VolleyLive yet';
describe('V1420-5: by number – nothing vanishes', () => {
  it('Enter while the lookup is still running: listed as checking…, then refused with reason + Dismiss', async () => {
    const s = await render(<Harness />);
    const f = () => s.getByTestId('side-a-phone');
    await fireEvent.changeText(f(), '9123456799');
    await fireEvent(f(), 'submitEditing'); // lookup not even started (debounce)
    expect(s.getByTestId('side-a-pending-checking')).toBeTruthy();
    expect(s.getByText(/91234 56799: checking…/)).toBeTruthy();
    await tick(200);
    expect(s.queryByTestId('side-a-pending-checking')).toBeNull();
    expect(s.getByTestId('side-a-pending-refused')).toBeTruthy();
    expect(s.getByText(/91234 56799: .*register/)).toBeTruthy();
    expect(s.getByTestId('side-a-dismiss-9123456799')).toBeTruthy();
  });
  it('a later successful add and typing keep the refused row; Dismiss removes only it', async () => {
    const s = await render(<Harness />);
    const f = () => s.getByTestId('side-a-phone');
    for (const d of ['99', '11']) { await fireEvent.changeText(f(), `90000000${d}`); await fireEvent(f(), 'submitEditing'); }
    await tick(200);
    expect(s.getByText('Player 11')).toBeTruthy();
    await fireEvent.changeText(f(), '98');
    expect(s.getByTestId('side-a-dismiss-9000000099')).toBeTruthy();
    await fireEvent.press(s.getByTestId('side-a-dismiss-9000000099'));
    expect(s.queryByTestId('side-a-pending-refused')).toBeNull();
    expect(s.getByText('Player 11')).toBeTruthy();
  });
  it('Enter on a number already shown as not registered: field kept, listed once with Dismiss (no duplicate line)', async () => {
    const s = await render(<Harness />);
    const f = () => s.getByTestId('side-a-phone');
    await fireEvent.changeText(f(), '9000000099');
    await tick(500);
    expect(s.getByTestId('side-a-not-registered')).toBeTruthy();
    await fireEvent(f(), 'submitEditing');
    await fireEvent(f(), 'submitEditing');
    expect(f().props.value).toBe('9000000099');
    expect(s.getAllByTestId('side-a-pending-refused')).toHaveLength(1);
    expect(s.queryByTestId('side-a-not-registered')).toBeNull();
    expect(s.getByTestId('side-a-dismiss-9000000099')).toBeTruthy();
  });
});
