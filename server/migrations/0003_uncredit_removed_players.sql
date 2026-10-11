-- VolleyLive 0003: finish the 0002 clean-up of guest players.
-- 0002 removed guest / typed-name players from match_players, but their points kept
-- player_key = 'guest:…' (and server_key in the rotation columns), so the event log still
-- credited ids that are no longer players. A point is a rally, so it is kept (deleting it would
-- change the score); only the credit to a player who is not in that match is cleared. The shot
-- type (kind) stays: it describes the rally, not the player.
-- Safe to run on any database, whether or not 0002 left such rows: every statement only
-- touches rows that are still invalid, so a re-run changes nothing.
-- ;;
UPDATE points p
  LEFT JOIN match_players mp ON mp.match_id = p.match_id AND mp.player_key = p.player_key
  SET p.player_key = NULL
  WHERE p.player_key IS NOT NULL AND mp.player_key IS NULL;
-- ;;
UPDATE points p
  LEFT JOIN match_players mp ON mp.match_id = p.match_id AND mp.player_key = p.server_key
  SET p.server_key = NULL
  WHERE p.server_key IS NOT NULL AND mp.player_key IS NULL;
-- ;;
-- Matches whose tournament 0002 deleted kept their fixture key; without a tournament it means nothing.
UPDATE matches SET fixture_key = NULL WHERE tournament_id IS NULL AND fixture_key IS NOT NULL;
