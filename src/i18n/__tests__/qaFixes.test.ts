/** Low-priority QA items F, H, I, J, K. */
import { distinctColor, TEAM_COLORS } from '../../core/types';
import { fixtureTitle } from '../../core/tournament';
import { BEACH_RULES as BEACH } from '../../core/rules';
import { buildMatch } from '../../services/matchFactory';
import i18n from '../index';
import { dataLabel, formatWhenT, hourLabel, translateError } from '../format';
import en from '../locales/en';
import hi from '../locales/hi';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../../services/backend', () => ({ backend: {} }));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('F: teams are told apart by colour', () => {
  test('distinctColor', () => {
    const red = TEAM_COLORS[0];
    expect(distinctColor(red, [])).toBe(red);
    expect(distinctColor(red.toLowerCase(), [red])).toBe(TEAM_COLORS[1]);
    expect(distinctColor(red, [red, '#001F4D'])).toBe(TEAM_COLORS[2]);
    expect(distinctColor('#123456', [red])).toBe('#123456');
    expect(distinctColor('#E53935', ['#E53935'])).toBe(red); // a team saved with the older red
  });
  test('buildMatch gives team B another colour when both kept the default', () => {
    const side = (name: string) => ({ name, color: TEAM_COLORS[0], players: [] });
    const m = buildMatch({ teamA: side('A'), teamB: side('B'), rules: BEACH, createdBy: 'u', scorerId: 'u' });
    expect(m.teamA.color).toBe(TEAM_COLORS[0]);
    expect(m.teamB.color).not.toBe(m.teamA.color);
  });
});

test('I: "1 player" / "1 team" plurals', async () => {
  expect(i18n.t('profile.players', { count: 1 })).toBe('1 player');
  expect(i18n.t('profile.players', { count: 6 })).toBe('6 players');
  expect(i18n.t('tournaments.teams', { count: 1 })).toBe('1 team');
  expect(i18n.t('tournaments.teams', { count: 4 })).toBe('4 teams');
  await i18n.changeLanguage('hi');
  expect(i18n.t('tournaments.teams', { count: 1 })).toBe('1 टीम');
  expect(i18n.t('tournaments.teams', { count: 4 })).toBe('4 टीमें');
});

describe('J: Hindi wording', () => {
  test('times use Hindi parts of the day, never Latin am/pm', async () => {
    const at = (h: number, m = 30) => new Date(2026, 9, 10, h, m).getTime();
    const enText = formatWhenT(at(18));
    expect(enText).toMatch(/pm|PM/);
    await i18n.changeLanguage('hi');
    const s = formatWhenT(at(18));
    expect(s).not.toMatch(/am|pm/i);
    expect(s).toContain('शाम 6:30');
    expect(formatWhenT(at(9, 5))).toContain('सुबह 9:05');
    expect(formatWhenT(at(13))).toContain('दोपहर 1:30');
    expect(formatWhenT(at(22))).toContain('रात 10:30');
    expect(hourLabel(7)).toBe('सुबह 7 बजे');
    expect(hourLabel(14)).toBe('दोपहर 2 बजे');
    expect(hourLabel(19)).toBe('शाम 7 बजे');
  });
  test('English hour labels are unchanged', () => {
    expect(hourLabel(7)).toBe('7am');
    expect(hourLabel(0)).toBe('12am');
    expect(hourLabel(12)).toBe('12pm');
    expect(hourLabel(19)).toBe('7pm');
  });
  test('Undo is "पूर्ववत", not "वापस" (Back); back button label is translated', () => {
    expect(hi.score.undo).toBe('पूर्ववत');
    expect(hi.score.undo).not.toBe(hi.common.back);
    expect(en.common.goBack).toBe('Go back');
    expect(hi.common.goBack).toMatch(/[\u0900-\u097F]/);
  });
});

describe('K: tournament titles and errors in Hindi', () => {
  test('a fixture title is stored in English and shown in each viewer’s language', async () => {
    await i18n.changeLanguage('hi'); // created by a Hindi user…
    const final = fixtureTitle('Diwali Cup', 'knockout', 3, 3);
    const league = fixtureTitle('Diwali Cup', 'league', 2, 5);
    expect(final).toBe('Diwali Cup · Final');
    expect(league).toBe('Diwali Cup · Round 2');
    expect(dataLabel(final)).toBe(`Diwali Cup · ${hi.rounds.final}`);
    await i18n.changeLanguage('en'); // …read by an English one
    expect(dataLabel(fixtureTitle('Diwali Cup', 'knockout', 2, 3))).toBe('Diwali Cup · Semi-finals');
    expect(dataLabel(league)).toBe('Diwali Cup · Round 2');
  });
  test.each([
    ['Duplicate team ids', 'duplicateTeams'],
    ['Need at least 2 teams', 'needTwoTeams'],
    ['bestOf must be 1, 3 or 5', 'rulesBestOf'],
    ['points per set must be positive', 'rulesPoints'],
    ['winBy must be at least 1', 'rulesWinBy'],
    ['pointCap must be >= pointsPerSet', 'rulesCap'],
    ['timeoutsPerSet cannot be negative', 'rulesTimeouts'],
  ] as const)('%s is translated', async (msg, key) => {
    await i18n.changeLanguage('hi');
    expect(translateError(new Error(msg))).toBe(hi.errors[key]);
  });
});

describe('registered-players re-test: server/API errors are translated (ids never shown)', () => {
  test.each([
    ['Every player must be a registered VolleyLive user: dev_919999999999', 'notUser'],
    ['Invalid request: teamB.players.0.id – Every player must be a registered VolleyLive user', 'notUser'],
    ['Each team needs at least 6 players before scoring can start [matches.roster.minPlayers]', 'needPlayers'],
    ['Tournament teams must be registered teams: ext_1', 'tournamentTeams'],
    ['A team needs at least 6 players to play: team_x [challenges.create.teamSize]', 'teamTooSmall'],
    ['Not a member of team team_smashers: seed13', 'notMember'],
    ['Unknown team team_fake', 'teamNotFound'],
    ['Event 1: seed7 is not a player of team A', 'pointNotOnTeam'],
    ['Participants must be the players of both teams (plus the creator or scorer)', 'participants'],
  ] as const)('%s', async (msg, key) => {
    await i18n.changeLanguage('hi');
    const out = translateError(new Error(msg));
    expect(out).toBe(i18n.t(`errors.${key}`, { min: 6, max: 12 }));
    expect(out).not.toMatch(/dev_|ext_1|seed\d|team_|\[/);
  });
  test('MIN/MAX come from the code, not hard-coded in the strings', () => {
    for (const loc of [en, hi]) {
      expect(loc.errors.teamTooSmall).toContain('{{min}}');
      expect(loc.errors.needPlayers).toContain('{{min}}');
      expect(loc.errors.tooManyPlayers).toContain('{{max}}');
    }
  });
  test('Hindi login has no Latin "OTP" / "Firebase"', () => {
    expect(hi.login.sendOtp).not.toMatch(/OTP/);
    expect(hi.login.demoBanner).not.toMatch(/Firebase/);
    expect(hi.home.demoBanner).not.toMatch(/Firebase/);
    expect(hi.errors.phoneDisabled).not.toMatch(/Firebase|README/);
  });
});
