-- VolleyLive 0002: registered players only.
-- Every match player is a registered user (no guests or typed names) and tournament teams are
-- registered teams. Rows that broke these rules before this migration (guest players,
-- name-only "ext_" tournament teams) can't be kept: guest players are removed from their
-- matches (their points stay in the log, uncredited) and tournaments with name-only teams are
-- deleted (their matches stay, unlinked). Run the seed again for fresh demo data.
-- match_sides.team_id stays NULL-able on purpose: a side built for one match by adding
-- registered players by mobile number is not a registered team (see server/RULES.md).
-- ;;
DELETE FROM match_players WHERE user_id IS NULL OR user_id <> player_key;
-- ;;
ALTER TABLE match_players DROP FOREIGN KEY fk_match_players_user;
-- ;;
ALTER TABLE match_players
  MODIFY player_key VARCHAR(140) NOT NULL COMMENT 'the player''s user id (same as user_id)',
  MODIFY user_id    VARCHAR(128) NOT NULL,
  ADD CONSTRAINT fk_match_players_user FOREIGN KEY (user_id) REFERENCES users (id),
  ADD CONSTRAINT ck_match_players_user CHECK (player_key = user_id);
-- ;;
DELETE FROM tournaments WHERE id IN (SELECT tournament_id FROM (SELECT DISTINCT tournament_id FROM tournament_teams WHERE team_id IS NULL) AS legacy);
-- ;;
ALTER TABLE tournament_teams DROP FOREIGN KEY fk_tournament_teams_team;
-- ;;
ALTER TABLE tournament_teams
  MODIFY team_key VARCHAR(64) NOT NULL COMMENT 'id used inside fixtures: the registered team id (same as team_id)',
  MODIFY team_id  VARCHAR(64) NOT NULL,
  ADD CONSTRAINT fk_tournament_teams_team FOREIGN KEY (team_id) REFERENCES teams (id),
  ADD CONSTRAINT ck_tournament_teams_team CHECK (team_key = team_id);
