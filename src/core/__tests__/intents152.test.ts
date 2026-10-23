/** 1.5.2 (Tester F151-5): read-only refusals only for action intent – names, nouns and questions route normally. */
import { parseIntent } from '../ask/intents';

const NOT_WRITE = ['Mark Fernandes stats', 'Pick Pereira stats', 'Close matches near me?', 'Set rules for a deciding set?', 'Start time of the final?', 'Finish time of the match?', 'end of the season rankings', 'set scores in the final', 'Mark Fernandes record', 'Chase Pereira stats', 'Close games this week', 'Pick-up games near me', 'Select Smashers roster'];
const WRITE = ['Mark my match as finished', 'Pick the player of the match', 'pick potm', 'Close the match', 'End the match now', 'finish my match', 'Start a new match', 'please set the score to 25-20', 'I want you to mark my match as finished', 'Confirm the result of my last match', 'Approve my match please', 'can you close it', 'Choose Fernandes as captain', 'Set the toss winner', 'close the challenge', 'go ahead and end our game', 'delete my team', 'Mark this result as confirmed'];

describe('F151-5', () => {
  it.each(NOT_WRITE)('%j routes normally (no read-only refusal)', (q) => expect(parseIntent(q).kind).not.toBe('write'));
  it.each(WRITE)('%j is an instruction → read-only refusal', (q) => expect(parseIntent(q).kind).toBe('write'));
});
