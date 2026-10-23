/** 1.5.7 (Tester F156-1 / F156-3 / F156-4): the optimistic chat bubble masks groupings with a ONE-digit group
 * ("9-876543210", "9-876-543-210", "9.876.543.210", "987654321-0", "+91 9-876543210", "9 876543210"), cued lists
 * ("Jersey 98 | 76 | 54 | 32 | 10 is my number") and phone-shaped score runs – exactly as the stored copy does. API host
 * (mocked reply) and the demo / local host (real askChatLocally). EN + HI. */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import { tokens } from '../../theme/tokens';
import { ThemeContext } from '../../theme/ThemeProvider';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock('../../services/dialogs', () => ({ confirmAsk: async () => true }));
const mockChat = jest.fn();
jest.mock('../../services/backend', () => ({ backend: { askChat: (q: string, l: string) => mockChat(q, l), askHistory: async () => [], clearAskHistory: async () => undefined } }));

const ctx = { name: 'day', t: tokens.day, setting: 'day', setSetting: () => {}, animate: false, setAnimate: () => {}, holdTransitions: () => {}, rallyEnded: () => {}, now: new Date(), generation: 0 } as never;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const item = (question: string) => ({ id: 's1', at: 1, question, lang: 'en', answer: 'ok', sources: [], idk: false, cards: [], outcome: 'answer', refusal: null, tools: [] });
const LEAK = /876543210|876-543|543\.210|987654321|98 \| 76|9-7 6-9|98\.212/;
const bubbles = (r: Awaited<ReturnType<typeof render>>) => r.queryAllByLabelText(new RegExp(`^${i18n.t('ask.you')}: `)).map((n) => n.props.accessibilityLabel as string);
const allText = (r: Awaited<ReturnType<typeof render>>) => JSON.stringify(r.toJSON());

async function open(lang: 'en' | 'hi') {
  await i18n.changeLanguage(lang);
  const Ask = require('../../app/ask').default;
  const r = await render(<ThemeContext.Provider value={ctx}><Ask /></ThemeContext.Provider>);
  await settle();
  return r;
}
async function sendText(r: Awaited<ReturnType<typeof render>>, q: string) {
  await fireEvent.changeText(r.getByTestId('ask-input'), q);
  await fireEvent.press(r.getByTestId('ask-send'));
}
afterEach(async () => { await i18n.changeLanguage('en'); mockChat.mockReset(); });

const QS = ['call 9-876543210', 'call 9-876-543-210', 'call 9.876.543.210', 'call 987654321-0', 'call +91 9-876543210', 'call 9 876543210', 'call 9-7 6-9 9-5 4321', 'call 98.212.143.21'];

describe.each(['en', 'hi'] as const)('F156-1 / F156-3 / F156-4 chat bubble (%s)', (lang) => {
  it.each(QS)('API host: %j is masked while waiting', async (q) => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, q);
    expect(mockChat).toHaveBeenCalledWith(q, lang);
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
  it.each(['what was the score 25-23 set', 'sets 9-7 6-9 9-5 7-9 5-3', 'matches at 06:30, 07:45, 09:00', 'Jersey 98 | 76 | 54 | 32 | 10 who scored?'])('%j in the bubble stays as typed', async (q) => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, q);
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: ${q}`]);
  });
  it('a cued list after the line: masked in the bubble', async () => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, 'Jersey 98 | 76 | 54 | 32 | 10 is my number');
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: Jersey [phone hidden] is my number`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
  it('the bubble equals the stored masker for every case', async () => {
    const { maskPii, maskPiiStored } = require('../../core/pii');
    for (const q of [...QS, 'call 9 876543210', 'jersey 9 8 7 6 5 4 3 2 1 0']) expect(maskPii(q)).toBe(maskPiiStored(q));
  });
  it('demo / local host (real askChatLocally): stored question masked', async () => {
    const { askChatLocally, resetAskChatLocal } = require('../../services/askLocal');
    resetAskChatLocal?.();
    mockChat.mockImplementation((q: string, l: 'en' | 'hi') => askChatLocally({} as never, `u157${lang}`, q, l));
    const r = await open(lang);
    await sendText(r, 'call +91 9-876-543-210');
    await settle();
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
});
