/** 1.5.5 (Tester F154-3 / F154-4). */
import { parseIntent } from '../ask/intents';

const live = (q: string) => { const i = parseIntent(q); return i.kind === 'tools' ? i.calls.find((c) => c.name === 'live_score') : undefined; };

describe('F154-3: set / score words are never a team name (EN / HI / Hinglish)', () => {
  it.each(['set ka score kya tha', 'तीसरे सेट का स्कोर क्या था?', 'what was the score 25-23 set', 'teesre set ka score', 'abhi ka score', 'पहले सेट का स्कोर क्या है?', 'score of set 2', 'last set ka score kitna tha'])('%j → live_score, no team', (q) => {
    const c = live(q);
    expect(c).toBeDefined();
    expect(c!.args.team).toBeUndefined();
  });
  it.each([
    ['what was the score 25-23 set Holdout Hawks', 'holdout hawks'], ['Delhi Smashers ka score kya hai', 'delhi smashers'],
    ['दिल्ली स्मैशर्स का स्कोर क्या है?', 'दिल्ली स्मैशर्स'], ['Blue Jays score', 'blue jays'], ['score of the 3rd set Holdout Hawks', 'holdout hawks'],
  ])('%j → live_score for team %j', (q, team) => expect(live(q)!.args.team).toBe(team));
});

describe('F154-4: captain changes → read-only refusal', () => {
  it.each([
    'please appoint Meera as captain', 'Rohan ko team ka captain set karo', 'मीरा को टीम का कप्तान चुनो', 'मीरा को कप्तान बनाओ', 'Meera ko captain banao',
    'appoint Rohan captain of Holdout Hawks', 'make Aarav the new captain', 'nominate Dev as vice captain', 'Aarav ko naya kaptaan chuno',
    'name Meera as our captain', 'elect Kabir captain', 'could you appoint Riya as the team captain', 'Kabir ko vice captain bana do',
  ])('%j → write', (q) => expect(parseIntent(q).kind).toBe('write'));
  it.each(['who is the captain of Holdout Hawks?', 'how do I pick a new captain', 'captain kaise chunte hain', 'कप्तान कैसे चुनें?', 'what does a captain do?', 'name the captain of Delhi Smashers', 'टीम का कप्तान कौन है?'])('%j is not a command', (q) => expect(parseIntent(q).kind).not.toBe('write'));
});
