/** 1.4.19 Help Center, Contact us and the admin support inbox – EN and HI. */
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import HelpScreen from '../../app/help';
import ContactScreen from '../../app/contact';
import AdminFeedbackScreen from '../../app/admin-feedback';
import { FAQS } from '../../core/helpFaq';
import type { SupportTicket } from '../../core/support';

let mockAdmin = false;
let mockContact = { email: null as string | null, whatsapp: null as string | null };
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (cb: () => void) => { const R = require('react'); R.useEffect(() => cb(), []); },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: mockAdmin, termsOk: true, user: { uid: 'me' } }), useMe: () => ({ id: 'me', name: 'Me' }) }));
jest.mock('../../state/toast', () => ({ showToast: jest.fn() }));
jest.mock('../../services/appVersion', () => ({ appVersionLabel: () => '1.4.19 (35)' }));
jest.mock('../../services/supportContact', () => ({
  ...jest.requireActual('../../services/supportContact'),
  supportContact: () => mockContact,
}));
const mockPick = jest.fn();
jest.mock('../../services/camera', () => ({ pickPhoto: () => mockPick() }));
const tk = (over: Partial<SupportTicket> = {}): SupportTicket => ({ id: 't1', userId: 'u1', userName: 'Asha Rao', topic: 'scoring', message: 'The score did not update after a rally.', appVersion: '1.4.19 (35)', status: 'open', screenshotUrl: null, createdAt: Date.now() - 60000, updatedAt: Date.now(), ...over });
const mockCreate = jest.fn(async () => 'new');
const mockSet = jest.fn(async () => {});
let mockMine: SupportTicket[] = [];
jest.mock('../../services/backend', () => ({
  backend: {
    createSupportTicket: (...a: unknown[]) => mockCreate(...(a as [])),
    listMySupportTickets: async () => mockMine,
    listSupportTickets: async () => [tk(), tk({ id: 't2', status: 'closed', topic: 'bug', userName: 'Ravi' })],
    setSupportTicketStatus: (...a: unknown[]) => mockSet(...(a as [])),
    listFeedback: async () => [],
  },
}));
jest.spyOn(require('react-native').Linking, 'openURL').mockImplementation(async () => true);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
afterEach(async () => { await i18n.changeLanguage('en'); jest.clearAllMocks(); mockAdmin = false; mockContact = { email: null, whatsapp: null }; mockMine = []; });

describe.each(['en', 'hi'] as const)('%s', (lang) => {
  const T = (k: string, o?: object) => i18n.getFixedT(lang)(k, o as never) as unknown as string;
  beforeEach(async () => { await i18n.changeLanguage(lang); });

  it('Help Center: categories, an answer opens, search narrows, no-result text', async () => {
    const r = await render(<HelpScreen />);
    await settle();
    expect(r.getByText(T('help.cat.abandon'))).toBeTruthy();
    expect(r.getByText(T('help.cat.tournaments'))).toBeTruthy();
    const f = FAQS.find((x) => x.id === 'tour-owner')!;
    await fireEvent.press(r.getByTestId('faq-tour-owner'));
    expect(r.getByText(f[lang].a)).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('help-search'), lang === 'en' ? 'abandon' : 'टूर्नामेंट');
    expect(r.queryByText(T('help.cat.registration'))).toBeNull();
    expect(r.getByTestId(lang === 'en' ? 'faq-abandon' : 'faq-tour-owner')).toBeTruthy();
    expect(r.queryByTestId('faq-reg-signin')).toBeNull();
    await fireEvent.changeText(r.getByTestId('help-search'), 'zzqqxx');
    expect(r.getByText(T('help.noResults', { q: 'zzqqxx' }))).toBeTruthy();
  });
  it('contact links hidden when not configured, shown when set; my messages listed', async () => {
    let r = await render(<HelpScreen />);
    await settle();
    expect(r.queryByTestId('help-email')).toBeNull();
    expect(r.queryByTestId('help-whatsapp')).toBeNull();
    expect(r.getByTestId('help-contact')).toBeTruthy();
    expect(r.getByText(`${T('help.supportSite')}: www.contact.com`)).toBeTruthy();
    await fireEvent.press(r.getByTestId('help-support-url'));
    expect(require('react-native').Linking.openURL).toHaveBeenCalledWith('https://www.contact.com');
    await r.unmount();
    mockContact = { email: 'help@example.com', whatsapp: '919876543210' };
    mockMine = [tk({ userId: 'me', status: 'replied' })];
    r = await render(<HelpScreen />);
    await settle();
    expect(r.getByText(T('help.email'))).toBeTruthy();
    expect(r.getByText(T('help.whatsapp'))).toBeTruthy();
    expect(r.getByText(T('help.myTickets'))).toBeTruthy();
    expect(r.getByText(new RegExp(T('support.status.replied')))).toBeTruthy();
  });
  it('Contact us: validation, screenshot limits, sends topic + message + version + screenshot', async () => {
    const r = await render(<ContactScreen />);
    await settle();
    await fireEvent.press(r.getByTestId('contact-send'));
    expect(r.getByText(T('errors.codes.support_topic'))).toBeTruthy();
    await fireEvent.press(r.getByTestId('contact-topic-bug'));
    await fireEvent.changeText(r.getByTestId('contact-message'), 'short');
    await fireEvent.press(r.getByTestId('contact-send'));
    expect(r.getByText(T('errors.codes.support_message_short', { min: 10 }))).toBeTruthy();
    mockPick.mockResolvedValueOnce({ uri: 'file:///a.gif', mimeType: 'image/gif', fileSize: 100 });
    await fireEvent.press(r.getByTestId('contact-pick'));
    await settle();
    expect(r.getByText(T('errors.codes.support_image_type'))).toBeTruthy();
    mockPick.mockResolvedValueOnce({ uri: 'file:///big.png', mimeType: 'image/png', fileSize: 6 * 1024 * 1024 });
    await fireEvent.press(r.getByTestId('contact-pick'));
    await settle();
    expect(r.getByText(T('errors.codes.support_image_size'))).toBeTruthy();
    mockPick.mockResolvedValueOnce({ uri: 'file:///ok.png', mimeType: 'image/png', fileSize: 1000 });
    await fireEvent.press(r.getByTestId('contact-pick'));
    await settle();
    expect(r.getByTestId('contact-shot')).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('contact-message'), 'The app froze while scoring.');
    await fireEvent.press(r.getByTestId('contact-send'));
    await settle();
    expect(mockCreate).toHaveBeenCalledWith({ topic: 'bug', message: 'The app froze while scoring.', appVersion: '1.4.19 (35)', screenshot: { uri: 'file:///ok.png', type: 'image/png', size: 1000 } });
    expect(r.getByText(T('support.topics.bug'))).toBeTruthy();
  });
  it('admin inbox: list, open, set status; non-admins locked out', async () => {
    let r = await render(<AdminFeedbackScreen />);
    await settle();
    expect(r.queryByText(T('support.inbox'))).toBeNull();
    await r.unmount();
    mockAdmin = true;
    r = await render(<AdminFeedbackScreen />);
    await settle();
    expect(r.getByText(T('support.inbox'))).toBeTruthy();
    expect(r.getByText(new RegExp(T('support.from', { name: 'Asha Rao' })))).toBeTruthy();
    await fireEvent.press(r.getByTestId('ticket-t1'));
    await fireEvent.press(r.getByTestId('ticket-t1-replied'));
    await settle();
    expect(mockSet).toHaveBeenCalledWith('t1', 'replied');
    expect(r.getByTestId('ticket-meta-t1').props.children).toContain(T('support.status.replied'));
  });
});
