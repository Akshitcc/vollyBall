/** 1.5.3 (Tester F152-5): right after sending, the user's chat bubble never shows a typed phone number; when the reply
 * arrives the bubble shows the host's stored (masked) question – API host (mocked server reply) and the demo / local
 * host (the real askChatLocally). EN + HI. */
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
const LEAK = /98123|45607|9 8 7 6 5|nau aath/;
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

describe.each(['en', 'hi'] as const)('F152-5 chat bubble (%s)', (lang) => {
  it('API host: masked while waiting, then replaced by the server\'s stored question', async () => {
    let reply!: (v: unknown) => void;
    mockChat.mockImplementation(() => new Promise((ok) => { reply = ok; }));
    const r = await open(lang);
    await sendText(r, 'My number is +91 (98123) 45607');
    expect(mockChat).toHaveBeenCalledWith('My number is +91 (98123) 45607', lang); // the host still gets what was typed
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: My number is [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
    await act(async () => { reply(item('My number is [phone hidden] (server)')); });
    await settle();
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: My number is [phone hidden] (server)`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
  it('API host: spaced digits / digit words are masked in the bubble too; an error keeps the masked bubble', async () => {
    mockChat.mockRejectedValue(Object.assign(new Error('x'), { code: 'network' }));
    const r = await open(lang);
    await sendText(r, 'call 9 8 7 6 5 4 3 2 1 0 or nau aath ek do teen char paanch chhe saat aath');
    await settle();
    expect(allText(r)).not.toMatch(LEAK);
    expect(bubbles(r)[0]).toContain('[phone hidden]');
  });
  it('demo / local host (real askChatLocally): the bubble shows the masked stored question', async () => {
    const { askChatLocally, resetAskChatLocal } = require('../../services/askLocal');
    resetAskChatLocal?.();
    mockChat.mockImplementation((q: string, l: 'en' | 'hi') => askChatLocally({} as never, `u153${lang}`, q, l));
    const r = await open(lang);
    await sendText(r, 'My number is +91 (98123) 45607');
    await settle();
    expect(mockChat).toHaveBeenCalled();
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: My number is [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
});
