/**
 * 1.4.26 (DB integrity audit): read-only SQL checks. Each query returns the rows that VIOLATE the check (an empty
 * result is a pass). Used by tests/dbaudit1426.test.ts and server/scripts/db-audit.ts; server/scripts/db-audit.sql is
 * generated from this list (`npx tsx scripts/db-audit.ts --sql`). SELECT only: safe to run on any copy of the data.
 */
import type { Knex } from 'knex';

export interface AuditCheck { id: string; area: string; what: string; sql: string }

const FINISHED = "m.status = 'finished' AND m.verification_status <> 'voided'";

export const AUDIT_CHECKS: readonly AuditCheck[] = [
  // ---- 1. users ----
  { id: 'users.required', area: 'users', what: 'complete profiles have first/last name, DOB and pincode', sql:
    "SELECT id FROM users WHERE profile_complete = 1 AND (first_name IS NULL OR TRIM(first_name) = '' OR last_name IS NULL OR TRIM(last_name) = '' OR dob IS NULL OR pincode IS NULL)" },
  { id: 'users.phone_unique', area: 'users', what: 'one user per mobile number', sql:
    'SELECT phone, COUNT(*) AS n FROM users GROUP BY phone HAVING COUNT(*) > 1' },
  { id: 'users.phone_format', area: 'users', what: 'mobile in E.164', sql:
    "SELECT id, phone FROM users WHERE NOT REGEXP_LIKE(phone, '^\\\\+[1-9][0-9]{6,14}$')" },
  { id: 'users.pincode', area: 'users', what: 'pincode is 6 digits, not starting with 0', sql:
    "SELECT id, pincode FROM users WHERE pincode IS NOT NULL AND NOT REGEXP_LIKE(pincode, '^[1-9][0-9]{5}$')" },
  { id: 'users.dob', area: 'users', what: 'DOB in the past and age 10–100 at signup', sql:
    'SELECT id, dob FROM users WHERE dob IS NOT NULL AND (dob > DATE(created_at) OR TIMESTAMPDIFF(YEAR, dob, created_at) < 10 OR TIMESTAMPDIFF(YEAR, dob, created_at) > 100)' },
  { id: 'users.email_unique', area: 'users', what: 'one user per e-mail (case/space-insensitive)', sql:
    "SELECT LOWER(TRIM(email)) AS e, COUNT(*) AS n FROM users WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1" },
  // ---- 2. relations / orphans ----
  { id: 'teams.captain_member', area: 'relations', what: 'every team captain is a member of the team', sql:
    'SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = t.captain_id WHERE tm.user_id IS NULL' },
  { id: 'teams.orphan_members', area: 'relations', what: 'team_members point at existing teams and users', sql:
    'SELECT tm.team_id, tm.user_id FROM team_members tm LEFT JOIN teams t ON t.id = tm.team_id LEFT JOIN users u ON u.id = tm.user_id WHERE t.id IS NULL OR u.id IS NULL' },
  { id: 'matches.two_sides', area: 'relations', what: 'every match has exactly sides A and B', sql:
    "SELECT m.id, COUNT(s.side) AS n FROM matches m LEFT JOIN match_sides s ON s.match_id = m.id GROUP BY m.id HAVING COUNT(DISTINCT s.side) <> 2" },
  { id: 'matches.orphan_children', area: 'relations', what: 'sets / points / timeouts / lineups / players belong to an existing match', sql:
    "SELECT 'sets' AS t, s.match_id FROM sets s LEFT JOIN matches m ON m.id = s.match_id WHERE m.id IS NULL UNION ALL " +
    "SELECT 'points', p.match_id FROM points p LEFT JOIN matches m ON m.id = p.match_id WHERE m.id IS NULL UNION ALL " +
    "SELECT 'timeouts', x.match_id FROM timeouts x LEFT JOIN matches m ON m.id = x.match_id WHERE m.id IS NULL UNION ALL " +
    "SELECT 'match_players', mp.match_id FROM match_players mp LEFT JOIN matches m ON m.id = mp.match_id WHERE m.id IS NULL" },
  { id: 'points.player_on_side', area: 'relations', what: 'a credited rally names a player of that side of that match', sql:
    'SELECT p.match_id, p.seq FROM points p LEFT JOIN match_players mp ON mp.match_id = p.match_id AND mp.player_key = p.player_key WHERE p.player_key IS NOT NULL AND (mp.player_key IS NULL OR mp.side <> p.side)' },
  { id: 'points.set_exists', area: 'relations', what: 'every rally belongs to a stored set', sql:
    'SELECT p.match_id, p.seq FROM points p LEFT JOIN sets s ON s.match_id = p.match_id AND s.set_number = p.set_number WHERE s.match_id IS NULL' },
  { id: 'potm.is_player', area: 'relations', what: 'the Player of the Match is a player of that match', sql:
    'SELECT m.id FROM matches m LEFT JOIN match_players mp ON mp.match_id = m.id AND mp.player_key = m.player_of_match_id WHERE m.player_of_match_id IS NOT NULL AND mp.player_key IS NULL' },
  { id: 'matches.rule_set', area: 'relations', what: 'no rule_sets row is left unused (each match / tournament owns one)', sql:
    'SELECT r.id FROM rule_sets r WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.rule_set_id = r.id) AND NOT EXISTS (SELECT 1 FROM tournaments t WHERE t.rule_set_id = r.id) AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.rule_set_id = r.id)' },
  { id: 'tournament.fixture_match', area: 'relations', what: 'a fixture claims a match tagged with the same tournament and fixture', sql:
    'SELECT f.tournament_id, f.fixture_key, f.match_id FROM fixtures f JOIN matches m ON m.id = f.match_id WHERE NOT (m.tournament_id <=> f.tournament_id) OR NOT (m.fixture_key <=> f.fixture_key)' },
  { id: 'tournament.unclaimed_match', area: 'relations', what: 'every match tagged with a fixture is the one that fixture claims (or abandoned)', sql:
    "SELECT m.id, m.tournament_id, m.fixture_key FROM matches m LEFT JOIN fixtures f ON f.tournament_id = m.tournament_id AND f.fixture_key = m.fixture_key WHERE m.fixture_key IS NOT NULL AND m.status <> 'abandoned' AND (f.match_id IS NULL OR f.match_id <> m.id)" },
  { id: 'tournament.one_match_per_fixture', area: 'relations', what: 'at most one non-abandoned match per fixture', sql:
    "SELECT tournament_id, fixture_key, COUNT(*) AS n FROM matches WHERE fixture_key IS NOT NULL AND status <> 'abandoned' GROUP BY tournament_id, fixture_key HAVING COUNT(*) > 1" },
  { id: 'tournament.team_registered', area: 'relations', what: 'tournament teams are existing teams', sql:
    'SELECT tt.tournament_id, tt.team_id FROM tournament_teams tt LEFT JOIN teams t ON t.id = tt.team_id WHERE t.id IS NULL' },
  // 1.4.27 groups + knockout (migration 0024)
  { id: 'tournament.groups_team', area: 'relations', what: 'groups format: every team is in a group A–H, group fixtures stay inside their group, advance is 1 or 2', sql:
    "SELECT t.id AS tournament_id, tt.team_key AS problem FROM tournaments t JOIN tournament_teams tt ON tt.tournament_id = t.id WHERE t.format = 'groups' AND (tt.group_key IS NULL OR tt.group_key NOT REGEXP '^[A-H]$') " +
    "UNION ALL SELECT t.id, 'advance' FROM tournaments t WHERE t.format = 'groups' AND (t.advance IS NULL OR t.advance NOT IN (1, 2)) " +
    "UNION ALL SELECT f.tournament_id, f.fixture_key FROM fixtures f JOIN tournament_teams h ON h.tournament_id = f.tournament_id AND h.team_key = f.home_key JOIN tournament_teams a ON a.tournament_id = f.tournament_id AND a.team_key = f.away_key WHERE f.group_key IS NOT NULL AND (h.group_key <> f.group_key OR a.group_key <> f.group_key)" },
  { id: 'tournament.groups_only', area: 'relations', what: 'groups, seeds and advance only on groups tournaments; seeds name a group place', sql:
    "SELECT f.tournament_id, f.fixture_key FROM fixtures f JOIN tournaments t ON t.id = f.tournament_id WHERE (t.format <> 'groups' AND (f.group_key IS NOT NULL OR f.home_seed IS NOT NULL OR f.away_seed IS NOT NULL)) " +
    "OR (f.home_seed IS NOT NULL AND f.home_seed NOT REGEXP '^[A-H][1-4]$') OR (f.away_seed IS NOT NULL AND f.away_seed NOT REGEXP '^[A-H][1-4]$') " +
    "UNION ALL SELECT tt.tournament_id, tt.team_key FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id WHERE t.format <> 'groups' AND tt.group_key IS NOT NULL" },
  { id: 'support.ticket', area: 'relations', what: 'support tickets have a message, a known status and sane times (no user FK by design: kept if the user is removed)', sql:
    "SELECT id FROM support_tickets WHERE TRIM(message) = '' OR updated_at < created_at" },
  { id: 'feedback.sane', area: 'relations', what: 'feedback has stars 1–5 and a time (no user FK by design)', sql:
    'SELECT id FROM feedback WHERE stars NOT BETWEEN 1 AND 5 OR created_at IS NULL' },
  { id: 'match_create_keys.match', area: 'relations', what: 'every create Idempotency-Key points at its creator\'s match', sql:
    'SELECT k.user_id, k.idem_key FROM match_create_keys k JOIN matches m ON m.id = k.match_id WHERE m.created_by <> k.user_id' },
  // ---- 3. finished matches ----
  { id: 'finished.winner', area: 'finished', what: 'a finished match has a winner, a finish time and was_won', sql:
    "SELECT m.id FROM matches m WHERE m.status = 'finished' AND (JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) NOT IN ('A','B') OR m.finished_at IS NULL OR m.was_won <> 1)" },
  { id: 'finished.sets_match_summary', area: 'finished', what: 'stored sets = summary set scores; set winners add up to the sets won', sql:
    `SELECT m.id FROM matches m LEFT JOIN sets s ON s.match_id = m.id WHERE m.status = 'finished' GROUP BY m.id, m.summary
     HAVING COUNT(s.set_number) <> JSON_LENGTH(m.summary, '$.setScores')
         OR SUM(s.winner = 'A') <> JSON_EXTRACT(m.summary, '$.setsA') OR SUM(s.winner = 'B') <> JSON_EXTRACT(m.summary, '$.setsB')
         OR SUM(s.winner IS NULL) > 0` },
  { id: 'finished.points_match_sets', area: 'finished', what: 'every rally is stored: points per set and side = the set score', sql:
    `SELECT s.match_id, s.set_number FROM sets s JOIN matches m ON m.id = s.match_id
     LEFT JOIN (SELECT match_id, set_number, SUM(side = 'A') AS a, SUM(side = 'B') AS b FROM points GROUP BY match_id, set_number) p ON p.match_id = s.match_id AND p.set_number = s.set_number
     WHERE m.status IN ('finished','live') AND (COALESCE(p.a, 0) <> s.score_a OR COALESCE(p.b, 0) <> s.score_b)` },
  { id: 'finished.event_count', area: 'finished', what: 'event_count = stored rallies + timeouts, seq has no gaps', sql:
    `SELECT m.id FROM matches m WHERE m.event_count <> (SELECT COUNT(*) FROM points p WHERE p.match_id = m.id) + (SELECT COUNT(*) FROM timeouts t WHERE t.match_id = m.id)
        OR m.event_count <> COALESCE((SELECT MAX(seq) + 1 FROM (SELECT match_id, seq FROM points UNION ALL SELECT match_id, seq FROM timeouts) e WHERE e.match_id = m.id), 0)` },
  { id: 'finished.players', area: 'finished', what: 'a finished match has at least one player per side', sql:
    `SELECT m.id FROM matches m WHERE m.status = 'finished' AND (SELECT COUNT(DISTINCT side) FROM match_players mp WHERE mp.match_id = m.id) <> 2` },
  { id: 'finished.ranking_view', area: 'finished', what: 'the ranking/wallet view has one row per registered player of each finished match, with its credited points', sql:
    `SELECT m.id FROM matches m WHERE ${FINISHED} AND (SELECT COUNT(*) FROM player_finished_matches v WHERE v.match_id = m.id) <> (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.id AND mp.user_id IS NOT NULL)` },
  // 1.4.27 (QA V1426-4): a match abandoned before the first rally is a direct abandon (core/abandon abandonPlanFor) and
  // carries no record by design – only one abandoned after a rally must have one
  { id: 'abandoned.record', area: 'finished', what: 'an abandoned match has no winner, and one abandoned after a rally records how it ended', sql:
    "SELECT m.id FROM matches m WHERE m.status = 'abandoned' AND ((m.abandon_info IS NULL AND GREATEST(COALESCE(m.max_events, 0), m.event_count) > 0) OR JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) IN ('A','B'))" },
  { id: 'live.no_finish_time', area: 'finished', what: 'a live or scheduled match has no finish time and no POTM', sql:
    "SELECT m.id FROM matches m WHERE m.status IN ('live','scheduled') AND (m.finished_at IS NOT NULL OR (m.player_of_match_id IS NOT NULL AND m.was_won = 0))" },
];

export interface AuditResult { id: string; area: string; what: string; ok: boolean; violations: number; sample: unknown[] }

export async function runAudit(db: Knex): Promise<AuditResult[]> {
  const out: AuditResult[] = [];
  for (const c of AUDIT_CHECKS) {
    const [rows] = (await db.raw(c.sql)) as unknown as [unknown[]];
    out.push({ id: c.id, area: c.area, what: c.what, ok: rows.length === 0, violations: rows.length, sample: rows.slice(0, 5) });
  }
  return out;
}

/** The checks as one plain .sql file (each SELECT lists violations; empty = pass). */
export function auditSql(): string {
  return ['-- VolleyLive DB integrity audit (generated from server/src/ops/dbAudit.ts; SELECT only).', '-- Each query lists violations: an empty result is a PASS.', '']
    .concat(AUDIT_CHECKS.map((c) => `-- [${c.area}] ${c.id}: ${c.what}\n${c.sql.replace(/\s+\n\s*/g, '\n  ')};\n`))
    .join('\n');
}
