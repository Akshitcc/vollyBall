/** The translated helpers must produce exactly the old English output in English. */
import { BEACH_RULES, INDOOR_RULES, describeRules, makeRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import { shareText } from '../../core/stats';
import { roundName } from '../../core/tournament';
import i18n from '../index';
import { dataLabel, describeRulesT, roundNameT, shareTextT, translateError } from '../format';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

afterEach(() => i18n.changeLanguage('en'));

describe('i18n format helpers', () => {
  const rulesList = [INDOOR_RULES, BEACH_RULES, makeRules(INDOOR_RULES, { bestOf: 1, pointsPerSet: 15 }), makeRules(BEACH_RULES, { winBy: 1 })];

  it('describeRulesT matches core describeRules in English', () => {
    for (const r of rulesList) expect(describeRulesT(r)).toBe(describeRules(r));
  });

  it('roundNameT matches core roundName in English', () => {
    for (let total = 1; total <= 5; total++) for (let r = 1; r <= total; r++) expect(roundNameT(r, total)).toBe(roundName(r, total));
  });

  it('shareTextT matches core shareText in English (live and finished)', () => {
    let ev = addPoint(INDOOR_RULES, [], 'A');
    ev = addPoint(INDOOR_RULES, ev, 'A');
    expect(shareTextT('Reds', 'Blues', INDOOR_RULES, ev, 'A', { location: 'Court 1' })).toBe(shareText('Reds', 'Blues', INDOOR_RULES, ev, 'A', { location: 'Court 1' }));
    const one = makeRules(INDOOR_RULES, { bestOf: 1, pointsPerSet: 3 });
    let fin = addPoint(one, [], 'B');
    fin = addPoint(one, fin, 'B');
    fin = addPoint(one, fin, 'B');
    expect(shareTextT('Reds', 'Blues', one, fin)).toBe(shareText('Reds', 'Blues', one, fin));
  });

  it('produces Hindi output in Hindi', async () => {
    await i18n.changeLanguage('hi');
    expect(describeRulesT(INDOOR_RULES)).toBe('इनडोर · बेस्ट ऑफ़ 5 · सेट 25 अंक तक, निर्णायक 15 तक · 2 अंक की बढ़त से जीत');
    expect(roundNameT(2, 2)).toBe('फ़ाइनल');
    expect(dataLabel('Sunday league')).toBe('संडे लीग');
    expect(dataLabel('Monsoon Cup 2026 · Semi-finals')).toBe('Monsoon Cup 2026 · सेमीफ़ाइनल');
    expect(dataLabel('My own title')).toBe('My own title');
    expect(translateError(new Error('Wrong code. In demo mode the code is 123456.'))).toBe('गलत कोड। डेमो मोड में कोड 123456 है।');
    expect(translateError(new Error('something unexpected'))).toBe(i18n.t('errors.generic')); // QA G16: never raw English
    // API server messages carry a rule id suffix; the translation still applies
    expect(translateError(new Error('Only the assigned scorer can change the score [matches.update.scorer]'))).toBe(i18n.t('errors.onlyScorer'));
    expect(translateError(new Error("This number isn't on VolleyLive yet. Ask them to register first. [teams.update.invitesOnlyRegistered]"))).toBe(i18n.t('errors.notRegistered'));
  });

  it('translateError keeps the original English messages in English', () => {
    expect(translateError(new Error('Firebase: Error (auth/invalid-verification-code).'))).toBe('That code is not correct. Please try again.');
    expect(translateError(new Error('Team not found'))).toBe('Team not found');
    expect(translateError(new Error('Firebase: other'))).toBe('Something went wrong. Please try again.'); // G16: never raw SDK text
  });
});
