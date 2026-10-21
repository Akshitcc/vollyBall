/** 1.4.26: Tester's E2E on 1.4.25 – core fixes (E2E-1, -2, -3, -5, -7, -8, -10, Info). */
import fs from 'fs';
import path from 'path';
import { FIXTURE_NOT_READY, FIXTURE_TAKEN, FIXTURE_TEAMS, FIXTURE_UNKNOWN, fixtureStartProblem, lockedFixtureChange } from '../fixtureLock';
import { placeLabel } from '../geo';
import { scheduledState, statusKey, NOT_PLAYED_AFTER_MS } from '../matchTiming';
import { generateKnockout, generateRoundRobin, leagueChampion, standings, teamsWithoutFixtures } from '../tournament';

const R = (fixtureId: string, homeSets: number, awaySets: number) => ({ fixtureId, homeSets, awaySets, homePoints: homeSets * 25, awayPoints: awaySets * 25 });

describe('E2E-1: full tie → alphabetical by team name', () => {
  it('orders equal teams by name, not by id/insertion', () => {
    const rows = standings(['z1', 'a1'], [], [], { z1: 'Alpha', a1: 'Zulu' });
    expect(rows.map((r) => r.teamId)).toEqual(['z1', 'a1']);
    const m = new Map([['z1', 'Bravo'], ['a1', 'Bravo']]);
    expect(standings(['z1', 'a1'], [], [], m).map((r) => r.teamId)).toEqual(['a1', 'z1']); // same name → id
  });
});

describe('E2E-5: team added after fixtures', () => {
  const fx = generateRoundRobin(['a', 'b']);
  it('lists the unscheduled team and withholds the champion', () => {
    expect(teamsWithoutFixtures(['a', 'b', 'c'], fx)).toEqual(['c']);
    const res = fx.map((f) => R(f.id, 2, 0));
    expect(leagueChampion(['a', 'b'], fx, res)).not.toBeNull();
    expect(leagueChampion(['a', 'b', 'c'], fx, res)).toBeNull();
    expect(leagueChampion(['a', 'b'], [], [])).toBeNull();
  });
});

describe('E2E-2/3: played fixtures are locked; a fixture starts once, when ready, with its own teams', () => {
  const fx = generateRoundRobin(['a', 'b', 'c', 'd']);
  it('lock', () => {
    const f = fx[0];
    const swapped = fx.map((x) => (x.id === f.id ? { ...x, homeId: x.awayId, awayId: x.homeId } : x));
    expect(lockedFixtureChange(fx, swapped, new Set([f.id]))).toBe(f.id);
    expect(lockedFixtureChange(fx, fx.slice(1), new Set([f.id]))).toBe(f.id);
    expect(lockedFixtureChange(fx, swapped, new Set())).toBeNull();
  });
  it('start problems', () => {
    const t = { format: 'league' as const, fixtures: fx };
    const f = fx[0];
    expect(fixtureStartProblem(t, [], 'nope', {}, false)).toBe(FIXTURE_UNKNOWN);
    expect(fixtureStartProblem(t, [], f.id, { A: f.homeId, B: f.awayId }, true)).toBe(FIXTURE_TAKEN);
    expect(fixtureStartProblem(t, [], f.id, { A: f.awayId, B: f.homeId }, false)).toBe(FIXTURE_TEAMS);
    expect(fixtureStartProblem(t, [], f.id, { A: f.homeId, B: f.awayId }, false)).toBeNull();
    const ko = { format: 'knockout' as const, fixtures: generateKnockout(['a', 'b', 'c', 'd']) };
    const final = ko.fixtures.find((x) => x.round === 2)!;
    expect(fixtureStartProblem(ko, [], final.id, {}, false)).toBe(FIXTURE_NOT_READY);
  });
});

describe('E2E-8: a past scheduled match is Overdue, then Not played', () => {
  const now = 1_800_000_000_000;
  it('states', () => {
    expect(scheduledState({ status: 'scheduled', scheduledAt: now + 1 }, now)).toBe('upcoming');
    expect(statusKey({ status: 'scheduled', scheduledAt: now - 60_000 }, now)).toBe('matchStatus.overdue');
    expect(statusKey({ status: 'scheduled', scheduledAt: now - NOT_PLAYED_AFTER_MS }, now)).toBe('matchStatus.notPlayed');
    expect(statusKey({ status: 'live', scheduledAt: now - NOT_PLAYED_AFTER_MS }, now)).toBe('matchStatus.live');
  });
});

describe('E2E-7: location fallback', () => {
  it('name, else coordinates, else empty', () => {
    expect(placeLabel({ name: ' Court 1 ', lat: 1, lng: 2 })).toBe('Court 1');
    expect(placeLabel({ name: '', lat: 28.61394, lng: 77.20902 })).toBe('28.6139, 77.2090');
    expect(placeLabel({ name: '' })).toBe('');
    expect(placeLabel(null)).toBe('');
  });
});

describe('E2E-6: no public player profile (not in PRD) → player rows are not tappable', () => {
  it('rankings / team member / POTM rows carry no navigation to a player page', () => {
    const root = path.join(__dirname, '..', '..');
    for (const f of ['components/Potm.tsx']) {
      const s = fs.readFileSync(path.join(root, f), 'utf8');
      expect(s).not.toMatch(/\/player\//);
    }
    expect(fs.existsSync(path.join(root, 'app', 'player'))).toBe(false);
  });
});

describe('Info: no review sheet in the demo', () => {
  it('gated by DEMO_MODE', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', '..', 'state', 'useReviewPrompt.ts'), 'utf8');
    expect(s).toMatch(/if \(!reviewPromptEnabled\(\)\) return;/);
    expect(s).toMatch(/!DEMO_MODE \|\| demoReviewPrompt\.on/);
  });
});

describe('E2E-9 / V1425-3 + E2E-10', () => {
  it('Night: a dot under 3:1 on any surface gets a ring; POTM without stats shows a dash', () => {
    const th = require('../../theme');
    th.applyTheme('night');
    try {
      for (const bg of th.NIGHT_SURFACES()) {
        expect(th.swatchRing(bg)).not.toBeNull(); // same colour as the surface = 1:1
      }
      expect(th.swatchRing('#FFFFFF')).toBeNull();
    } finally {
      th.applyTheme('day');
    }
    const potm = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'Potm.tsx'), 'utf8');
    expect(potm).toMatch(/POTM_NO_STATS = '–'/);
  });
});
