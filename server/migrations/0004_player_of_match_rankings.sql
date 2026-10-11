-- VolleyLive 0004: Player of the Match + rankings. ADDITIVE ONLY: one new nullable column, one
-- index and one view. No existing row or column is changed or removed.
-- player_of_match_id: the match_players.player_key of the Player of the Match, set once by the
-- scorer when the match finishes (src/core/potm.ts); NULL = not chosen.
-- ;;
ALTER TABLE matches
  ADD COLUMN player_of_match_id VARCHAR(140) NULL COMMENT 'Player of the Match (match_players.player_key), set by the scorer when the match finishes' AFTER challenge_id,
  ADD KEY ix_matches_potm (player_of_match_id);
-- ;;
-- One row per registered player per FINISHED match: did their side win, how many points were
-- credited to them, and were they Player of the Match. GET /api/rankings sums this per player and
-- ranks the totals with the shared src/core/ranking.ts rankPlayers() (weights, minimum, tie order).
CREATE OR REPLACE VIEW player_finished_matches AS
SELECT
  mp.match_id,
  mp.user_id,
  mp.side,
  CASE WHEN (SELECT COUNT(*) FROM sets s WHERE s.match_id = mp.match_id AND s.winner = mp.side)
          > (SELECT COUNT(*) FROM sets s WHERE s.match_id = mp.match_id AND s.winner IS NOT NULL AND s.winner <> mp.side)
       THEN 1 ELSE 0 END AS won,
  (SELECT COUNT(*) FROM points p WHERE p.match_id = mp.match_id AND p.player_key = mp.player_key) AS credited_points,
  CASE WHEN m.player_of_match_id = mp.player_key THEN 1 ELSE 0 END AS potm
FROM match_players mp
JOIN matches m ON m.id = mp.match_id
WHERE m.status = 'finished' AND mp.user_id IS NOT NULL;
