/**
 * New Match team builder: players are added one at a time by mobile number. A registered user
 * shows as a card (name + photo, never their number) with an Add button; an unregistered number
 * shows the register-first message and adds nothing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import { TeamBuilder, type BuiltTeam } from '../TeamBuilder';
import type { UserProfile } from '../../core/types';
import i18n from '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const mockUsers: Record<string, UserProfile> = {
  '+919000000011': { id: 'seed2', name: 'Diya Kapoor', phone: '+919000000011', photoURL: null, position: 'setter', createdAt: 0 } as UserProfile,
  '+919000000012': { id: 'seed3', name: 'Kabir Singh', phone: '+919000000012', photoURL: null, position: 'any', createdAt: 0 } as UserProfile,
};
const mockFind = jest.fn(async (phone: string): Promise<UserProfile | null> => mockUsers[phone] ?? null);
jest.mock('../../services/backend', () => ({ backend: { findUserByPhone: (p: string) => mockFind(p) } }));

function Harness({ other = [] as string[], initial = [] as BuiltTeam['players'], onChange = (_: BuiltTeam) => {} }) {
  const [v, setV] = useState<BuiltTeam>({ kind: 'build', name: 'Sand Kings', color: '#E53935', players: initial });
  return (
    <TeamBuilder
      value={v}
      otherPlayerIds={other}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
      testID="tb"
    />
  );
}

const typeNumber = async (n: string) => {
  await fireEvent.changeText(screen.getByTestId('tb-phone'), n);
  await act(async () => {
    jest.advanceTimersByTime(400); // debounce
  });
};

// Load-safe (fix re-test 214 #2): one warm-up render, lookup and add up front, so a cold cache's module
// loading isn't timed inside the first test; then a tight per-test timeout (WARM_T backstops the warm-up).
const WARM_T = 15_000;
jest.setTimeout(5_000);
beforeAll(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('en');
  await render(<Harness />);
  await typeNumber('90000 00011');
  await fireEvent.press(screen.getByTestId('tb-add'));
  await typeNumber('90000 00099'); // the register-first message too
  await screen.unmount();
  jest.useRealTimers();
}, WARM_T);
beforeEach(async () => {
  jest.useFakeTimers();
  mockFind.mockClear();
  await i18n.changeLanguage('en');
});
afterEach(() => jest.useRealTimers());

it('looks up a typed number, shows the found card (no phone number) and adds the player', async () => {
  const onChange = jest.fn();
  await render(<Harness onChange={onChange} />);
  expect(screen.getByText('Add 6 more players (6 needed to start).')).toBeTruthy();
  await typeNumber('90000 00011');
  expect(mockFind).toHaveBeenCalledWith('+919000000011');
  expect(screen.getByTestId('tb-found')).toBeTruthy();
  expect(screen.getByText('Diya Kapoor')).toBeTruthy();
  expect(screen.getByText('On VolleyLive')).toBeTruthy();
  // the other user's stored number is never rendered (only what the scorer typed, "90000 00011")
  // (the field now holds the cleaned 10 digits the scorer typed: that is the only occurrence)
  const tree = JSON.stringify(screen.toJSON());
  expect(tree).not.toContain('+919000000011');
  expect(tree.split('9000000011').length - 1).toBe(1);
  expect(screen.getByTestId('tb-phone').props.value).toBe('9000000011');
  await fireEvent.press(screen.getByTestId('tb-add'));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ players: [{ id: 'seed2', name: 'Diya Kapoor', photoURL: null }] }));
  expect(screen.queryByTestId('tb-found')).toBeNull();
  expect(screen.getByTestId('tb-phone').props.value).toBe('');
  expect(screen.getByText('Players: 1/12')).toBeTruthy();
  expect(screen.getByText('Add 5 more players (6 needed to start).')).toBeTruthy();
});

it('an unregistered number shows the register-first message and adds nothing', async () => {
  const onChange = jest.fn();
  await render(<Harness onChange={onChange} />);
  await typeNumber('98111 11111');
  expect(screen.getByText("This number isn't on VolleyLive yet. Ask them to register first.")).toBeTruthy();
  expect(screen.queryByTestId('tb-add')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('in Hindi too', async () => {
  await i18n.changeLanguage('hi');
  await render(<Harness />);
  await typeNumber('98111 11111');
  expect(screen.getByText('यह नंबर अभी VolleyLive पर नहीं है। उनसे पहले रजिस्टर करने को कहें।')).toBeTruthy();
  await typeNumber('9000000012');
  expect(screen.getByText('Kabir Singh')).toBeTruthy();
  expect(screen.getByText('VolleyLive पर है')).toBeTruthy();
});

it('blocks adding a player twice or a player who is on the other team', async () => {
  const onChange = jest.fn();
  await render(<Harness other={['seed3']} initial={[{ id: 'seed2', name: 'Diya Kapoor', photoURL: null }]} onChange={onChange} />);
  await typeNumber('9000000011');
  expect(screen.getByText('Diya Kapoor is already in this team.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('tb-add'));
  await typeNumber('9000000012');
  expect(screen.getByText('Kabir Singh is already in the other team.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('tb-add'));
  expect(onChange).not.toHaveBeenCalled();
});

it('stops at 12 players and has no free-text name entry for players', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, name: `Player ${i}`, photoURL: null }));
  await render(<Harness initial={twelve} />);
  expect(screen.getByText('Players: 12/12')).toBeTruthy();
  expect(screen.queryByTestId('tb-phone')).toBeNull();
  expect(screen.queryByTestId('tb-need')).toBeNull();
  // only two inputs exist in the builder: the side's name and the phone (gone when full)
  expect(screen.getAllByTestId(/^tb-/).map((n) => n.props.testID)).toEqual(['tb-name', 'tb-full']);
  // QA retest: the number box no longer just disappears; a message says the team is full
  expect(screen.getByTestId('tb-full').props.children).toBe('Team full (12 players). Remove a player to add someone else.');
});

it('a failed lookup shows a translated message, not the raw error', async () => {
  mockFind.mockImplementationOnce(async () => {
    throw new Error('Every player must be a registered VolleyLive user: dev_919999999999 [users.lookup]');
  });
  await i18n.changeLanguage('hi');
  await render(<Harness />);
  await typeNumber('9000000099');
  const text = screen.getByTestId('tb-lookup-error').props.children as string;
  expect(text).not.toMatch(/dev_|users\.lookup|Every player/);
  expect(text).toMatch(/[\u0900-\u097F]/);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

it('ignores a slow answer for a number that was replaced meanwhile', async () => {
  let resolveSlow: (u: UserProfile | null) => void = () => {};
  mockFind.mockImplementationOnce(() => new Promise<UserProfile | null>((r) => (resolveSlow = r)));
  await render(<Harness />);
  await typeNumber('9000000011'); // slow lookup pending
  await typeNumber('9000000012');
  await act(async () => resolveSlow(mockUsers['+919000000011']));
  expect(screen.getByText('Kabir Singh')).toBeTruthy();
  expect(screen.queryByText('Diya Kapoor')).toBeNull();
});

describe('QA B1: add by number gives inline feedback and never looks up an invalid number', () => {
  it.each([
    ['12 digits', '987654321012', '987654321012'],
    ['emoji', '98765😀', '98765'],
    ['9 digits', '987654321', '987654321'],
    ['starts with 1', '1234567890', '1234567890'],
  ])('%s', async (_label, bad, shown) => {
    await render(<Harness />);
    await typeNumber(bad);
    expect(screen.getByTestId('tb-phone-error')).toBeTruthy();
    expect(screen.getByText('Enter a valid 10-digit mobile number')).toBeTruthy();
    expect(mockFind).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tb-add')).toBeNull();
    // B121-8 (1.3.1): the add-player field filters to digits as you type; the digits stay visible
    // next to the error (never a silently empty field); nothing invalid is looked up or added.
    expect(screen.getByTestId('tb-phone').props.value).toBe(shown);
  });
  it('letters only: nothing is typed, the "digits only" note says why', async () => {
    await render(<Harness />);
    await typeNumber('abc');
    expect(screen.getByTestId('tb-phone').props.value).toBe('');
    expect(screen.getByTestId('tb-phone-digits-only')).toBeTruthy();
    expect(mockFind).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tb-add')).toBeNull();
  });
  it('the error is in Hindi too, and goes away once the number is valid', async () => {
    await i18n.changeLanguage('hi');
    await render(<Harness />);
    await typeNumber('5876543210');
    expect(screen.getByText('मान्य 10 अंकों का मोबाइल नंबर दर्ज करें')).toBeTruthy();
    await typeNumber('9000000011');
    expect(screen.queryByTestId('tb-phone-error')).toBeNull();
    expect(mockFind).toHaveBeenCalledWith('+919000000011');
    await i18n.changeLanguage('en');
  });
});

it('QA B5: the duplicate-player reason has its own full-width line and wraps (never cut off)', async () => {
  await render(<Harness initial={[{ id: 'seed2', name: 'Diya Kapoor', photoURL: null }]} />);
  await typeNumber('90000 00011');
  const reason = screen.getByTestId('tb-problem');
  expect(reason.props.children).toMatch(/Diya Kapoor/);
  expect(reason.props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId('tb-add').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
});
