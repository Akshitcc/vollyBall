/**
 * 1.5.0 Ask VolleyLive: rich chat cards. Built DETERMINISTICALLY from tool results (never from model text), so a
 * provider cannot invent numbers in a card. Only public fields – no phone, e-mail, wallet or private profile data.
 */
export interface CardTeam { id?: string | null; name: string; color: string }
export interface ScoreboardCard {
  type: 'scoreboard'; matchId: string; status: 'scheduled' | 'live' | 'finished' | 'abandoned'; title?: string | null;
  teamA: CardTeam; teamB: CardTeam; setsA: number; setsB: number; currentA: number; currentB: number; sets: [number, number][]; winner: 'A' | 'B' | null;
}
export interface StandingsRowCard { pos: number; teamId: string; name: string; color: string; played: number; won: number; lost: number; setsWon: number; setsLost: number; points: number; q: boolean }
export interface StandingsCard { type: 'standings'; tournamentId: string; title: string; group?: string | null; rows: StandingsRowCard[]; champion?: string | null }
export interface StatCard { type: 'stat'; playerId: string; name: string; mine: boolean; rank: number | null; matches: number; wins: number; winPct: number; rankingPoints: number; potm: number }
export interface FixtureItem { id: string; matchId?: string | null; label: string; home: string; away: string; status: 'scheduled' | 'live' | 'finished' | 'abandoned' | 'open'; setsA?: number | null; setsB?: number | null; when?: number | null; /** 1.5.1 (F150-7): a finished result's state */ result?: import('../resultStatus').ResultStatus | null }
export interface FixturesCard { type: 'fixtures'; title: string; items: FixtureItem[] }
export interface RosterCard { type: 'roster'; teamId: string; name: string; color: string; players: { id: string; name: string; captain: boolean; sub: boolean }[] }
export interface ListCard { type: 'list'; kind: 'teams' | 'challenges' | 'leaderboard' | 'players' | 'tournaments'; items: { id: string; title: string; subtitle?: string | null; value?: string | null; mine?: boolean }[] }
export type AskCard = ScoreboardCard | StandingsCard | StatCard | FixturesCard | RosterCard | ListCard;
export const ASK_CARD_TYPES = ['scoreboard', 'standings', 'stat', 'fixtures', 'roster', 'list'] as const;
/** Cards per answer (the screen stays readable). */
export const ASK_MAX_CARDS = 3;
/** Rows per card. */
export const ASK_CARD_ROWS = 10;
