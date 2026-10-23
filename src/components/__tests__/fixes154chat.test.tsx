/** 1.5.4 (Tester F153-1 / F153-2): the optimistic chat bubble masks single digits joined by dashes / dots / slashes /
 * commas / mixed separators, "+91-…" and the new Hinglish words – API host (mocked reply) and the demo / local host
 * (real askChatLocally, whose stored question is masked too). EN + HI. */
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
const LEAK = /9-8-7|9\.8\.7|9\/8\/7|9,8,7|8-7\.6|ath ek do|chah saat/;
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

const QS = ['call 9-8-7-6-5-4-3-2-1-0', 'call 9.8.7.6.5.4.3.2.1.0', 'call 9/8/7/6/5/4/3/2/1/0', 'call 9 8-7.6 5 4 3-2.1 0', 'call +91-9-8-7-6-5-4-3-2-1-0', 'call 9,8,7,6,5,4,3,2,1,0', 'call no ath ek do teen chār paanch chah saat aath'];

describe.each(['en', 'hi'] as const)('F153-1 / F153-2 chat bubble (%s)', (lang) => {
  it.each(QS)('API host: %j is masked while waiting', async (q) => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, q);
    expect(mockChat).toHaveBeenCalledWith(q, lang);
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
  it('a set score in the bubble stays as typed', async () => {
    mockChat.mockImplementation(() => new Promise(() => {}));
    const r = await open(lang);
    await sendText(r, 'what was the score 25-23 set');
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: what was the score 25-23 set`]);
  });
  it('demo / local host (real askChatLocally): stored question masked', async () => {
    const { askChatLocally, resetAskChatLocal } = require('../../services/askLocal');
    resetAskChatLocal?.();
    mockChat.mockImplementation((q: string, l: 'en' | 'hi') => askChatLocally({} as never, `u154${lang}`, q, l));
    const r = await open(lang);
    await sendText(r, 'call 9 8-7.6 5 4 3-2.1 0');
    await settle();
    expect(bubbles(r)).toEqual([`${i18n.t('ask.you')}: call [phone hidden]`]);
    expect(allText(r)).not.toMatch(LEAK);
  });
});
