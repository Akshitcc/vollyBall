/** 1.4.21 regression tests – rendered paths, EN and HI: help?faq expand + scroll (V1420-6), Ask libero source opens the
 * in-app FAQ (V1420-6), HI answers in Hindi (V1420-2), Hindi cut matches the counter (V1420-4), signed-out message. */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ScrollView } from 'react-native';
import i18n from '../../i18n';
import HelpScreen from '../../app/help';
import AskScreen from '../../app/ask';
import ContactScreen from '../../app/contact';
import { answerQuestion, buildIndex } from '../../core/ask';
import { CodedError } from '../../core/codedError';
import { FAQS } from '../../core/helpFaq';
import { SUPPORT_MESSAGE_MAX } from '../../core/support';

let mockParams: { faq?: string } = {};
const mockPush = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: (...a: unknown[]) => mockPush(...a) },
  Stack: { Screen: () => null },
  useFocusEffect: (cb: () => void) => { const R = require('react'); R.useEffect(() => cb(), []); },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true, user: { uid: 'me' } }), useMe: () => ({ id: 'me', name: 'Me' }) }));
jest.mock('../../state/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../services/appVersion', () => ({ appVersionLabel: () => '1.4.21 (37)' }));
jest.mock('../../services/camera', () => ({ pickPhoto: jest.fn() }));
const mockIx = buildIndex();
let mockSignedOut = false;
jest.mock('../../services/backend', () => ({
  backend: {
    listMySupportTickets: async () => [],
    createSupportTicket: jest.fn(async () => 'new'),
    askVolleyLive: (q: string, l: 'en' | 'hi') => {
      if (mockSignedOut) return Promise.reject(new (require('../../core/codedError').CodedError)('ask_sign_in', 'Sign in to ask VolleyLive'));
      return require('../../core/ask').answerQuestion(mockIx, q, l);
    },
  },
}));
jest.spyOn(require('react-native').Linking, 'openURL').mockImplementation(async () => true);
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(async () => { await i18n.changeLanguage('en'); jest.clearAllMocks(); mockParams = {}; mockSignedOut = false; });
void answerQuestion; void CodedError;

describe.each(['en', 'hi'] as const)('%s', (lang) => {
  const T = (k: string, o?: object) => i18n.getFixedT(lang)(k, o as never) as unknown as string;
  beforeEach(async () => { await i18n.changeLanguage(lang); });

  it('V1420-6 /help?faq=<id> opens that FAQ and scrolls to it; a new ?faq on the open screen clears the search and opens it too', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: () => void }, 'scrollTo').mockImplementation(() => {});
    mockParams = { faq: 'account-delete' };
    const r = await render(<HelpScreen />);
    await settle();
    const f = FAQS.find((x) => x.id === 'account-delete')!;
    expect(r.getByTestId('faq-account-delete-answer').props.children).toBe(f[lang].a);
    const item = r.getByTestId('faq-account-delete-focused');
    const cat = r.getByTestId(`help-cat-${f.category}`);
    await act(async () => { cat.props.onLayout({ nativeEvent: { layout: { y: 900, x: 0, width: 300, height: 400 } } }); item.props.onLayout({ nativeEvent: { layout: { y: 120, x: 0, width: 300, height: 80 } } }); });
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ y: 900 + 120 - 8, animated: true });
    // the screen is reused (router.push from Ask): a search is showing, then another FAQ is asked for
    await fireEvent.changeText(r.getByTestId('help-search'), 'zzzz');
    expect(r.getByTestId('help-results')).toBeTruthy();
    mockParams = { faq: 'team-positions' };
    await r.rerender(<HelpScreen />);
    await settle();
    expect(r.queryByTestId('help-results')).toBeNull();
    expect(r.getByTestId('faq-team-positions-answer')).toBeTruthy();
    scrollTo.mockRestore();
  });

  it('V1420-6 an item laid out BEFORE the ?faq arrives still scrolls (web: no second layout event)', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype as unknown as { scrollTo: () => void }, 'scrollTo').mockImplementation(() => {});
    const r = await render(<HelpScreen />);
    await settle();
    const f = FAQS.find((x) => x.id === 'team-positions')!;
    await act(async () => {
      r.getByTestId(`help-cat-${f.category}`).props.onLayout({ nativeEvent: { layout: { y: 700, x: 0, width: 300, height: 300 } } });
      r.getByTestId('faq-team-positions-item').props.onLayout({ nativeEvent: { layout: { y: 50, x: 0, width: 300, height: 60 } } });
    });
    mockParams = { faq: 'team-positions' };
    await r.rerender(<HelpScreen />);
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ y: 700 + 50 - 8, animated: true });
    scrollTo.mockRestore();
  });

  it('V1420-6 + V1420-2 libero: answer in this language, source opens the in-app FAQ (not FIVB)', async () => {
    const r = await render(<AskScreen />);
    await fireEvent.changeText(r.getByTestId('ask-input'), lang === 'en' ? 'what is a libero' : 'what is a libero'); // same English question in both UIs
    await fireEvent.press(r.getByTestId('ask-send'));
    await settle();
    expect(r.getByTestId('ask-answer-1')).toBeTruthy();
    const note = require('../../core/ask/rulesKnowledge').RULE_NOTES.find((x: { id: string }) => x.id === 'rule-libero');
    expect(r.getByText(`1. ${note[lang].title}`)).toBeTruthy(); // the source title is in the UI language
    expect(r.queryByText(new RegExp(T('ask.rulesSource', { title: 'XXX' }).replace('XXX', '.*').replace(/[()]/g, '\\$&')))).toBeNull();
    await fireEvent.press(r.getByTestId('ask-source-1-0'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/help', params: { faq: 'team-positions' } });
    expect(require('react-native').Linking.openURL).not.toHaveBeenCalled();
  });

  it('cosmetic: asking while signed out shows the friendly sign-in message', async () => {
    mockSignedOut = true;
    const r = await render(<AskScreen />);
    await fireEvent.changeText(r.getByTestId('ask-input'), 'how do I sign in');
    await fireEvent.press(r.getByTestId('ask-send'));
    await settle();
    expect(r.getByText(T('errors.codes.ask_sign_in'))).toBeTruthy();
  });

  it('V1420-4 Hindi: the cut lands exactly where the counter says 2000', async () => {
    const r = await render(<ContactScreen />);
    await fireEvent.changeText(r.getByTestId('contact-message'), 'क्षि'.repeat(SUPPORT_MESSAGE_MAX + 5));
    expect(r.getByTestId('contact-cut')).toBeTruthy();
    expect(r.getByText(T('support.count', { n: SUPPORT_MESSAGE_MAX, max: SUPPORT_MESSAGE_MAX }))).toBeTruthy();
  });
});
