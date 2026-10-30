/** 1.5.9 – Tester fixes-retest.md 1.5.8 section + the steering items (pure logic; no rendering). */
import fs from 'node:fs';
import path from 'node:path';
import i18n from '../../i18n';
import { dataLabel, placeLabelT } from '../../i18n/format';
import { onAdminReviewList, playedForAdminReview } from '../abandon';
import { planStepMove } from '../../hooks/useWebStepHistory';
import { answerQuestion, buildIndex, retrieve } from '../ask';
import { FAQS } from '../helpFaq';
import { INDOOR_RULES, BEACH_RULES } from '../rules';
import type { Match } from '../types';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const root = path.resolve(__dirname, '../../..');
afterAll(async () => i18n.changeLanguage('en'));

describe('F158-10: "Pinned location" follows the app language', () => {
  it.each([['en', 'Pinned location'], ['hi', 'पिन की गई जगह']])('%s', async (lang, want) => {
    await i18n.changeLanguage(lang);
    for (const stored of ['Pinned location', 'पिन की गई जगह']) {
      expect(dataLabel(stored)).toBe(want);
      expect(placeLabelT({ name: stored, lat: 28.6, lng: 77.2 })).toBe(want);
    }
    expect(placeLabelT({ name: 'Siri Fort Court', lat: 1, lng: 2 })).toBe('Siri Fort Court');
    expect(placeLabelT({ name: '', lat: 28.61234, lng: 77.2 })).toBe('28.6123, 77.2000');
    expect(placeLabelT(null)).toBe('');
  });
  it('every place shown on a card / page goes through placeLabelT (tournament cards, match cards, court, map, home)', () => {
    for (const f of ['src/app/(tabs)/tournaments.tsx', 'src/components/MatchCard.tsx', 'src/app/tournament/[id].tsx', 'src/app/court/[id].tsx', 'src/app/(tabs)/map.tsx', 'src/app/(tabs)/index.tsx', 'src/app/match/[id]/index.tsx']) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).toContain('placeLabelT(');
      expect(src).not.toMatch(/\{\s*(t|m|court|c|i)\.location(\?)?\.name\s*\}/);
      expect(src).not.toMatch(/[^T]placeLabel\(/);
    }
  });
});

const M = (o: Partial<Match>) => ({ id: 'x', status: 'finished', teamA: { players: [] }, teamB: { players: [] }, events: [], rules: INDOOR_RULES, ...o }) as unknown as Match;
describe('F158-11: the admin review list = played matches only', () => {
  it('scheduled matches are never listed (even an unconfirmable demo shape)', () => {
    expect(onAdminReviewList(M({ status: 'scheduled', scorerReassign: { from: 'b1', to: 's1', by: 'adm', at: 1 } as never }))).toBe(false);
    expect(onAdminReviewList(M({ status: 'scheduled' }))).toBe(false);
  });
  it('a live match only with a pending abandon request', () => {
    expect(onAdminReviewList(M({ status: 'live' }))).toBe(false);
  });
  it('the demo seed: the future "flagged" matches are gone, the played flagged one stays', async () => {
    const { makeSeed } = require('../../services/backend/demoSeed');
    const seed = makeSeed(Date.now()) as { matches: Record<string, Match> };
    const listed = Object.values(seed.matches).filter(onAdminReviewList).map((m) => m.id);
    expect(listed).toContain('match_flagged');
    expect(listed).not.toContain('match_demo_gu11');
    expect(listed).not.toContain('match_demo_capmix');
    for (const id of listed) expect(['finished', 'abandoned', 'live']).toContain(seed.matches[id].status);
  });
  it('approve / void buttons only on a finished match (admin-review.tsx)', () => {
    const src = fs.readFileSync(path.join(root, 'src/app/admin-review.tsx'), 'utf8');
    expect(src).toMatch(/m\.status === 'finished' \? \(\s*<AdminReviewButtons/);
    expect(src).toContain('l.filter(playedForAdminReview)');
    expect(playedForAdminReview(M({ status: 'scheduled' }))).toBe(false);
    expect(playedForAdminReview(M({ status: 'live' }))).toBe(false);
    expect(playedForAdminReview(M({ status: 'finished' }))).toBe(true);
  });
});

describe('F158-12: never "8/6 starters"', () => {
  it('Gurgaon Giants: 8 players = 6 starters + 2 subs in the seed; no seeded team has more than 6 starters', () => {
    const { makeSeed } = require('../../services/backend/demoSeed');
    const seed = makeSeed(Date.now()) as { teams: Record<string, { memberIds: string[]; subIds: string[] }> };
    const g = seed.teams.team_giants;
    expect(g.memberIds).toHaveLength(8);
    expect(g.subIds).toHaveLength(2);
    for (const t of Object.values(seed.teams)) expect(t.memberIds.filter((m) => !t.subIds.includes(m)).length).toBeLessThanOrEqual(6);
  });
  it('the over-the-limit summary exists in EN and HI', async () => {
    for (const lang of ['en', 'hi']) {
      await i18n.changeLanguage(lang);
      const s = i18n.t('team.summaryOver', { starters: 8, size: 6, subs: 0, extra: 2 });
      expect(s).toContain('8');
      expect(s).toContain('6');
      expect(s).not.toContain('8/6');
    }
  });
});

describe('F158-9: browser history for the New Match steps', () => {
  it('forward pushes; back goes to the matching entry; a jump with no entry replaces', () => {
    expect(planStepMove([0], 1)).toEqual({ push: true });
    expect(planStepMove([0, 1], 2)).toEqual({ push: true });
    expect(planStepMove([0, 1, 2], 1)).toEqual({ go: -1 });
    expect(planStepMove([0, 1, 2], 0)).toEqual({ go: -2 });
    expect(planStepMove([0, 2], 1)).toEqual({ replace: true });
    expect(planStepMove([0, 2], 0)).toEqual({ go: -1 });
  });
  it('the New Match screen moves through it and unwinds before leaving', () => {
    const src = fs.readFileSync(path.join(root, 'src/app/match/new.tsx'), 'utf8');
    expect(src).toContain('useWebStepHistory<NewMatchStep>(step, setStep)');
    expect(src).toMatch(/await webSteps\.unwind\(\);[^\n]*\n\s*if \(startNow\) router\.replace/);
  });
});

describe('F158-5: "how many timeouts are there" (EN / HI)', () => {
  const idx = buildIndex();
  it('the FAQ exists in both languages and matches the presets', () => {
    const f = FAQS.find((x) => x.id === 'score-timeouts')!;
    expect(f).toBeTruthy();
    expect(INDOOR_RULES.timeoutsPerSet).toBe(2);
    expect(BEACH_RULES.timeoutsPerSet).toBe(1);
    expect(f.en.a).toContain('2 per set');
    expect(f.en.a).toContain('1 with Beach');
    expect(f.hi.a).toContain('हर सेट 2');
  });
  it.each([
    ['how many timeouts are there', 'en'], ['How many time-outs does each team get?', 'en'], ['how many time outs per set', 'en'],
    ['कितने टाइमआउट होते हैं?', 'hi'], ['टाइम आउट कितने मिलते हैं', 'hi'], ['कितने टाइम-आउट होते हैं', 'hi'], ['kitne timeout hote hain', 'hi'],
  ] as const)('%s → the timeouts FAQ + the timeouts rule, never team size', async (q, lang) => {
    const ids = retrieve(idx, q, lang).map((h) => h.id.replace(/:(en|hi)(#\d+)?$/, ''));
    expect(ids[0]).toBe('faq:score-timeouts');
    expect(ids).toContain('rules:rule-subs-timeouts');
    expect(ids).not.toContain('faq:team-size');
    const a = await answerQuestion(idx, q, lang);
    expect(a.idk).toBe(false);
  });
});

describe('F158-3: the migration script and the app agree on the key lists', () => {
  it('PUBLIC / LEGACY keys = firebaseProfileDocs.ts', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mig = require('../../../scripts/admin/migrate-private-profiles.js');
    const docs = require('../../services/backend/firebaseProfileDocs');
    expect(mig.PUBLIC_KEYS).toEqual([...docs.PUBLIC_PROFILE_KEYS]);
    expect(mig.LEGACY_KEYS).toEqual([...docs.LEGACY_PUBLIC_KEYS]);
  });
  it('refuses a real project unless confirmed (and never with the emulator set)', () => {
    const { checkTarget } = require('../../../scripts/admin/migrate-private-profiles.js');
    expect(checkTarget(['--project', 'prod'], {}).error).toBeTruthy();
    expect(checkTarget(['--project', 'prod'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181' }).error).toBeTruthy();
    expect(checkTarget(['--project', 'a', '--real-project', 'b'], {}).error).toBeTruthy();
    expect(checkTarget(['--project', 'demo-x'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8181' })).toEqual({ project: 'demo-x', real: false });
  });
});
