/** 1.4.20 Ask VolleyLive chat screen – EN and HI: grounded answer with sources, I don't know + Contact us, errors. */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import AskScreen from '../../app/ask';
import { answerQuestion, buildIndex } from '../../core/ask';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }, Stack: { Screen: () => null } }));
const ix = buildIndex();
const mockAsk = jest.fn((q: string, lang: 'en' | 'hi') => answerQuestion(ix, q, lang));
jest.mock('../../services/backend', () => ({ backend: { askVolleyLive: (q: string, l: 'en' | 'hi') => mockAsk(q, l) } }));
const openURL = jest.spyOn(require('react-native').Linking, 'openURL').mockImplementation(async () => true);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
afterEach(async () => { await i18n.changeLanguage('en'); jest.clearAllMocks(); });

describe.each(['en', 'hi'] as const)('%s', (lang) => {
  const T = (k: string, o?: object) => i18n.getFixedT(lang)(k, o as never) as unknown as string;
  beforeEach(async () => { await i18n.changeLanguage(lang); });
  const ask = async (r: Awaited<ReturnType<typeof render>>, q: string) => {
    await fireEvent.changeText(r.getByTestId('ask-input'), q);
    await fireEvent.press(r.getByTestId('ask-send'));
    await settle();
  };
  it('grounded answer with numbered sources; a rule source opens the FIVB page, an FAQ source the Help Center', async () => {
    const r = await render(<AskScreen />);
    expect(r.getByText(T('ask.intro'))).toBeTruthy();
    await ask(r, lang === 'en' ? 'How many points win a set?' : 'एक सेट कितने पॉइंट पर जीतते हैं');
    expect(mockAsk).toHaveBeenCalledWith(expect.any(String), lang);
    expect(r.getByTestId('ask-answer-1')).toBeTruthy();
    expect(r.getByText(T('ask.sources'))).toBeTruthy();
    await fireEvent.press(r.getByTestId('ask-source-1-0'));
    expect(openURL).toHaveBeenCalledWith('https://www.fivb.com/volleyball/the-game/official-volleyball-rules/');
    await ask(r, lang === 'en' ? 'how do I sign in' : 'साइन इन कैसे करूँ');
    await fireEvent.press(r.getByTestId('ask-source-2-0'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/help', params: { faq: 'reg-signin' } });
  });
  it("I don't know + Contact us", async () => {
    const r = await render(<AskScreen />);
    await ask(r, 'bitcoin price today');
    expect(r.getByText(T('ask.idk'))).toBeTruthy();
    await fireEvent.press(r.getByTestId('ask-contact-1'));
    expect(mockPush).toHaveBeenCalledWith('/contact');
  });
  it('a refused question shows the translated error; too short does nothing', async () => {
    mockAsk.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: 'rate_limited', retryAfter: 30 }); });
    const r = await render(<AskScreen />);
    await ask(r, 'ab');
    expect(mockAsk).not.toHaveBeenCalled();
    await ask(r, 'what is a libero');
    expect(r.getByText(T('errors.codes.rate_limited', { seconds: 30 }))).toBeTruthy();
  });
});
