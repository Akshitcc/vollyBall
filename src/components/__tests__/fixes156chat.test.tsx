/** 1.5.6 (Tester F155-1 / F155-2): the optimistic chat bubble masks GROUPED phones joined by any non-alphanumeric run
 * ("98765|43210", "+91|98765|43210", "987#654#3210", "98765 • 43210", "+91·98765·43210", "98|76|54|32|10") and impossible /
 * cued score lines – API host (mocked reply) and the demo / local host (real askChatLocally). EN + HI. */
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
const LEAK = /98765|43210|987#654|3210|98\|76|9-7 9-6|9-7 6-9/;
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

const QS = ['call 98765|43210', 'call +91|98765|43210', 'call 987#654#3210', 'call 98765 • 43210', 'call +91·98765·43210', 'call 98|76|54|32|10', 'call 9876*543*210', 'call 98765~43210', 'call 9-7 9-6 6-9 9-5 5-3', 'call 9-7 6-9 9-5 7-9 5-3'];

describe.each(['en', 'hi'] as const)('F155-1 / F155-2 chat bubble (%s)', (lang) => {
  it.each(QS)('API host: %j is masked while waiting', async (q) => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, q);
    expect(mockChat).toHaveBeenCalledWith(q, lang);
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
  it.each(['what was the score 25-23 set', 'sets 9-7 6-9 9-5 7-9 5-3', 'matches at 06:30, 07:45, 09:00'])('%j in the bubble stays as typed', async (q) => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, q);
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: ${q}`]);
  });
  it('demo / local host (real askChatLocally): stored question masked', async () => {
    const { askChatLocally, resetAskChatLocal } = require('../../services/askLocal');
    resetAskChatLocal?.();
    mockChat.mockImplementation((q: string, l: 'en' | 'hi') => askChatLocally({} as never, `u156${lang}`, q, l));
    const r = await open(lang);
    await sendText(r, 'call +91|98765 • 43210');
    await settle();
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
});
