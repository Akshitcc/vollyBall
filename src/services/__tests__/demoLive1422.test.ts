/** 1.4.22: the scripted demo live match used for Live scoring screenshots in both themes (mockup state 19–17, sets 1–1). */
import { makeSeed } from '../backend/demoSeed';

describe('demo seed: match_live_set3', () => {
  const db = makeSeed(1_800_000_000_000);
  const m = db.matches['match_live_set3'];
  it('is live, mid set 3, 19–17, sets 1–1', () => {
    expect(m.status).toBe('live');
    expect(m.summary.setsA).toBe(1);
    expect(m.summary.setsB).toBe(1);
    expect([m.summary.currentA, m.summary.currentB]).toEqual([19, 17]);
    expect(m.summary.setScores.map((x: { a: number; b: number }) => [x.a, x.b])).toEqual([[25, 21], [22, 25]]);
  });
  it('the demo user (seed1) is its scorer; the original live match is untouched', () => {
    expect(m.scorerId).toBe('seed1');
    expect(db.matches['match_live'].title).toBe('Sunday league');
  });
});
