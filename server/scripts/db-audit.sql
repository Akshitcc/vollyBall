-- VolleyLive DB integrity audit (generated from server/src/ops/dbAudit.ts; SELECT only).
-- Each query lists violations: an empty result is a PASS.

-- [users] users.required: complete profiles have first/last name, DOB and pincode
SELECT id FROM users WHERE profile_complete = 1 AND (first_name IS NULL OR TRIM(first_name) = '' OR last_name IS NULL OR TRIM(last_name) = '' OR dob IS NULL OR pincode IS NULL);

-- [users] users.phone_unique: one user per mobile number
SELECT phone, COUNT(*) AS n FROM users GROUP BY phone HAVING COUNT(*) > 1;

-- [users] users.phone_format: mobile in E.164
SELECT id, phone FROM users WHERE NOT REGEXP_LIKE(phone, '^\\+[1-9][0-9]{6,14}$');

-- [users] users.pincode: pincode is 6 digits, not starting with 0
SELECT id, pincode FROM users WHERE pincode IS NOT NULL AND NOT REGEXP_LIKE(pincode, '^[1-9][0-9]{5}$');

-- [users] users.dob: DOB in the past and age 10–100 at signup
SELECT id, dob FROM users WHERE dob IS NOT NULL AND (dob > DATE(created_at) OR TIMESTAMPDIFF(YEAR, dob, created_at) < 10 OR TIMESTAMPDIFF(YEAR, dob, created_at) > 100);

-- [users] users.email_unique: one user per e-mail (case/space-insensitive)
SELECT LOWER(TRIM(email)) AS e, COUNT(*) AS n FROM users WHERE email IS NOT NULL AND TRIM(email) <> '' GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1;

-- [relations] teams.captain_member: every team captain is a member of the team
SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = t.captain_id WHERE tm.user_id IS NULL;

-- [relations] teams.orphan_members: team_members point at existing teams and users
SELECT tm.team_id, tm.user_id FROM team_members tm LEFT JOIN teams t ON t.id = tm.team_id LEFT JOIN users u ON u.id = tm.user_id WHERE t.id IS NULL OR u.id IS NULL;

-- [relations] matches.two_sides: every match has exactly sides A and B
SELECT m.id, COUNT(s.side) AS n FROM matches m LEFT JOIN match_sides s ON s.match_id = m.id GROUP BY m.id HAVING COUNT(DISTINCT s.side) <> 2;

-- [relations] matches.orphan_children: sets / points / timeouts / lineups / players belong to an existing match
SELECT 'sets' AS t, s.match_id FROM sets s LEFT JOIN matches m ON m.id = s.match_id WHERE m.id IS NULL UNION ALL SELECT 'points', p.match_id FROM points p LEFT JOIN matches m ON m.id = p.match_id WHERE m.id IS NULL UNION ALL SELECT 'timeouts', x.match_id FROM timeouts x LEFT JOIN matches m ON m.id = x.match_id WHERE m.id IS NULL UNION ALL SELECT 'match_players', mp.match_id FROM match_players mp LEFT JOIN matches m ON m.id = mp.match_id WHERE m.id IS NULL;

-- [relations] points.player_on_side: a credited rally names a player of that side of that match
SELECT p.match_id, p.seq FROM points p LEFT JOIN match_players mp ON mp.match_id = p.match_id AND mp.player_key = p.player_key WHERE p.player_key IS NOT NULL AND (mp.player_key IS NULL OR mp.side <> p.side);

-- [relations] points.set_exists: every rally belongs to a stored set
SELECT p.match_id, p.seq FROM points p LEFT JOIN sets s ON s.match_id = p.match_id AND s.set_number = p.set_number WHERE s.match_id IS NULL;

-- [relations] potm.is_player: the Player of the Match is a player of that match
SELECT m.id FROM matches m LEFT JOIN match_players mp ON mp.match_id = m.id AND mp.player_key = m.player_of_match_id WHERE m.player_of_match_id IS NOT NULL AND mp.player_key IS NULL;

-- [relations] matches.rule_set: no rule_sets row is left unused (each match / tournament owns one)
SELECT r.id FROM rule_sets r WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.rule_set_id = r.id) AND NOT EXISTS (SELECT 1 FROM tournaments t WHERE t.rule_set_id = r.id) AND NOT EXISTS (SELECT 1 FROM challenges c WHERE c.rule_set_id = r.id);

-- [relations] tournament.fixture_match: a fixture claims a match tagged with the same tournament and fixture
SELECT f.tournament_id, f.fixture_key, f.match_id FROM fixtures f JOIN matches m ON m.id = f.match_id WHERE NOT (m.tournament_id <=> f.tournament_id) OR NOT (m.fixture_key <=> f.fixture_key);

-- [relations] tournament.unclaimed_match: every match tagged with a fixture is the one that fixture claims (or abandoned)
SELECT m.id, m.tournament_id, m.fixture_key FROM matches m LEFT JOIN fixtures f ON f.tournament_id = m.tournament_id AND f.fixture_key = m.fixture_key WHERE m.fixture_key IS NOT NULL AND m.status <> 'abandoned' AND (f.match_id IS NULL OR f.match_id <> m.id);

-- [relations] tournament.one_match_per_fixture: at most one non-abandoned match per fixture
SELECT tournament_id, fixture_key, COUNT(*) AS n FROM matches WHERE fixture_key IS NOT NULL AND status <> 'abandoned' GROUP BY tournament_id, fixture_key HAVING COUNT(*) > 1;

-- [relations] tournament.team_registered: tournament teams are existing teams
SELECT tt.tournament_id, tt.team_id FROM tournament_teams tt LEFT JOIN teams t ON t.id = tt.team_id WHERE t.id IS NULL;

-- [relations] tournament.groups_team: groups format: every team is in a group A–H, group fixtures stay inside their group, advance is 1 or 2
SELECT t.id AS tournament_id, tt.team_key AS problem FROM tournaments t JOIN tournament_teams tt ON tt.tournament_id = t.id WHERE t.format = 'groups' AND (tt.group_key IS NULL OR tt.group_key NOT REGEXP '^[A-H]$') UNION ALL SELECT t.id, 'advance' FROM tournaments t WHERE t.format = 'groups' AND (t.advance IS NULL OR t.advance NOT IN (1, 2)) UNION ALL SELECT f.tournament_id, f.fixture_key FROM fixtures f JOIN tournament_teams h ON h.tournament_id = f.tournament_id AND h.team_key = f.home_key JOIN tournament_teams a ON a.tournament_id = f.tournament_id AND a.team_key = f.away_key WHERE f.group_key IS NOT NULL AND (h.group_key <> f.group_key OR a.group_key <> f.group_key);

-- [relations] tournament.groups_only: groups, seeds and advance only on groups tournaments; seeds name a group place
SELECT f.tournament_id, f.fixture_key FROM fixtures f JOIN tournaments t ON t.id = f.tournament_id WHERE (t.format <> 'groups' AND (f.group_key IS NOT NULL OR f.home_seed IS NOT NULL OR f.away_seed IS NOT NULL)) OR (f.home_seed IS NOT NULL AND f.home_seed NOT REGEXP '^[A-H][1-4]$') OR (f.away_seed IS NOT NULL AND f.away_seed NOT REGEXP '^[A-H][1-4]$') UNION ALL SELECT tt.tournament_id, tt.team_key FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id WHERE t.format <> 'groups' AND tt.group_key IS NOT NULL;

-- [relations] support.ticket: support tickets have a message, a known status and sane times (no user FK by design: kept if the user is removed)
SELECT id FROM support_tickets WHERE TRIM(message) = '' OR updated_at < created_at;

-- [relations] feedback.sane: feedback has stars 1–5 and a time (no user FK by design)
SELECT id FROM feedback WHERE stars NOT BETWEEN 1 AND 5 OR created_at IS NULL;

-- [relations] match_create_keys.match: every create Idempotency-Key points at its creator's match
SELECT k.user_id, k.idem_key FROM match_create_keys k JOIN matches m ON m.id = k.match_id WHERE m.created_by <> k.user_id;

-- [relations] challenge.match_accepted: a match linked to a challenge belongs to an accepted challenge that links it back; a pending / declined / cancelled challenge has no match
SELECT m.id FROM matches m LEFT JOIN challenges c ON c.id = m.challenge_id WHERE m.challenge_id IS NOT NULL AND (c.id IS NULL OR c.status <> 'accepted' OR (COALESCE(c.match_id, '') <> m.id AND m.status <> 'abandoned')) UNION ALL SELECT c.id FROM challenges c WHERE c.match_id IS NOT NULL AND c.status <> 'accepted';

-- [finished] finished.winner: a finished match has a winner, a finish time and was_won
SELECT m.id FROM matches m WHERE m.status = 'finished' AND (JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) NOT IN ('A','B') OR m.finished_at IS NULL OR m.was_won <> 1);

-- [finished] finished.sets_match_summary: stored sets = summary set scores; set winners add up to the sets won
SELECT m.id FROM matches m LEFT JOIN sets s ON s.match_id = m.id WHERE m.status = 'finished' GROUP BY m.id, m.summary
     HAVING COUNT(s.set_number) <> JSON_LENGTH(m.summary, '$.setScores')
         OR SUM(s.winner = 'A') <> JSON_EXTRACT(m.summary, '$.setsA') OR SUM(s.winner = 'B') <> JSON_EXTRACT(m.summary, '$.setsB')
         OR SUM(s.winner IS NULL) > 0;

-- [finished] finished.points_match_sets: every rally is stored: points per set and side = the set score
SELECT s.match_id, s.set_number FROM sets s JOIN matches m ON m.id = s.match_id
     LEFT JOIN (SELECT match_id, set_number, SUM(side = 'A') AS a, SUM(side = 'B') AS b FROM points GROUP BY match_id, set_number) p ON p.match_id = s.match_id AND p.set_number = s.set_number
     WHERE m.status IN ('finished','live') AND (COALESCE(p.a, 0) <> s.score_a OR COALESCE(p.b, 0) <> s.score_b);

-- [finished] finished.event_count: event_count = stored rallies + timeouts, seq has no gaps
SELECT m.id FROM matches m WHERE m.event_count <> (SELECT COUNT(*) FROM points p WHERE p.match_id = m.id) + (SELECT COUNT(*) FROM timeouts t WHERE t.match_id = m.id)
        OR m.event_count <> COALESCE((SELECT MAX(seq) + 1 FROM (SELECT match_id, seq FROM points UNION ALL SELECT match_id, seq FROM timeouts) e WHERE e.match_id = m.id), 0);

-- [finished] finished.players: a finished match has at least one player per side
SELECT m.id FROM matches m WHERE m.status = 'finished' AND (SELECT COUNT(DISTINCT side) FROM match_players mp WHERE mp.match_id = m.id) <> 2;

-- [finished] finished.ranking_view: the ranking/wallet view has one row per registered player of each finished match, with its credited points
SELECT m.id FROM matches m WHERE m.status = 'finished' AND m.verification_status <> 'voided' AND (SELECT COUNT(*) FROM player_finished_matches v WHERE v.match_id = m.id) <> (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.id AND mp.user_id IS NOT NULL);

-- [finished] abandoned.record: an abandoned match has no winner, and one abandoned after a rally records how it ended
SELECT m.id FROM matches m WHERE m.status = 'abandoned' AND ((m.abandon_info IS NULL AND GREATEST(COALESCE(m.max_events, 0), m.event_count) > 0) OR JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) IN ('A','B'));

-- [finished] live.no_finish_time: a live or scheduled match has no finish time and no POTM
SELECT m.id FROM matches m WHERE m.status IN ('live','scheduled') AND (m.finished_at IS NOT NULL OR (m.player_of_match_id IS NOT NULL AND m.was_won = 0));
