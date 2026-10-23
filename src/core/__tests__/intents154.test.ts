/** 1.5.4 (Tester F153-4 / F153-5 / disputed paraphrases). */
import { parseIntent } from '../ask/intents';

const toolsOf = (q: string) => { const i = parseIntent(q); return i.kind === 'tools' ? i.calls : []; };

describe('F153-4: captain changes → read-only refusal', () => {
  it.each([
    'pick Aarav as the team captain', 'set Rohan as team captain', 'Pick Meera as the new captain of Holdout Hawks',
    'choose Riya as our new captain', 'please set Kabir as the vice captain', 'select Dev as captain', 'Choose Fernandes as captain',
  ])('%j → write', (q) => expect(parseIntent(q).kind).toBe('write'));
  it.each(['who is the captain of Blue Jays', 'how do I pick a new captain', 'Pick Pereira stats', 'can a captain pick the team name ideas'])('%j is not a command', (q) => expect(parseIntent(q).kind).not.toBe('write'));
});

describe('F153-5: a set score is not a team name', () => {
  it.each(['what was the score 25-23 set', 'what is the score of the 3rd set', 'what was the score 25 - 23 in the last set', 'live score 15:13 set'])('%j → live_score with no team', (q) => {
    const c = toolsOf(q).find((x) => x.name === 'live_score');
    expect(c).toBeDefined();
    expect(c!.args.team).toBeUndefined();
  });
  it('a real team name is still picked up', () => {
    expect(toolsOf('Blue Jays score').find((x) => x.name === 'live_score')!.args.team).toBe('blue jays');
  });
});

describe('disputed paraphrases → help / FAQ', () => {
  it.each(['If the admin approves my rejected match, will it count?', 'What happens after I reject a result?', 'what happens if my result is disputed?'])('%j → rag', (q) => expect(parseIntent(q).kind).toBe('rag'));
  it.each(['when is my next match', 'show my results'])('%j still → my data', (q) => expect(parseIntent(q).kind).toBe('tools'));
});
