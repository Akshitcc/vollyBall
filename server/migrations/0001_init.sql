-- VolleyLive schema v1 (MySQL 8.0+ / 8.4 LTS). All timestamps are UTC DATETIME(3).
-- Statements are separated by a line containing only `-- ;;` so the runner can split safely.
-- IDs: users.id is the Firebase Auth uid; every other entity uses a string id (UUID by default).

CREATE TABLE users (
  id          VARCHAR(128) NOT NULL,
  name        VARCHAR(60)  NOT NULL,
  phone       VARCHAR(20)  NOT NULL COMMENT 'E.164, verified by the Firebase ID token',
  photo_url   VARCHAR(1024) NULL,
  position    ENUM('setter','outside','middle','opposite','libero','any') NOT NULL DEFAULT 'any',
  city        VARCHAR(80)  NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_phone (phone),
  CONSTRAINT chk_users_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 60),
  CONSTRAINT chk_users_phone CHECK (phone REGEXP '^\\+[1-9][0-9]{6,14}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE device_tokens (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(128) NOT NULL,
  token       VARCHAR(255) NOT NULL COMMENT 'Expo push token',
  platform    VARCHAR(16)  NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_tokens_token (token),
  KEY ix_device_tokens_user (user_id),
  CONSTRAINT fk_device_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE rule_sets (
  id                          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  preset                      ENUM('indoor','beach','custom') NOT NULL,
  best_of                     TINYINT UNSIGNED NOT NULL,
  points_per_set              TINYINT UNSIGNED NOT NULL,
  deciding_set_points         TINYINT UNSIGNED NOT NULL,
  win_by                      TINYINT UNSIGNED NOT NULL,
  point_cap                   TINYINT UNSIGNED NULL,
  timeouts_per_set            TINYINT UNSIGNED NOT NULL,
  side_switch_every           TINYINT UNSIGNED NULL,
  deciding_side_switch_every  TINYINT UNSIGNED NULL,
  deciding_switch_at          TINYINT UNSIGNED NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_rule_sets_best_of CHECK (best_of IN (1, 3, 5)),
  CONSTRAINT chk_rule_sets_points CHECK (points_per_set BETWEEN 1 AND 99 AND deciding_set_points BETWEEN 1 AND 99),
  CONSTRAINT chk_rule_sets_win_by CHECK (win_by BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE teams (
  id          VARCHAR(64)  NOT NULL,
  name        VARCHAR(40)  NOT NULL,
  name_lower  VARCHAR(40)  GENERATED ALWAYS AS (LOWER(name)) STORED,
  color       VARCHAR(16)  NOT NULL,
  captain_id  VARCHAR(128) NOT NULL,
  city        VARCHAR(80)  NULL,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_teams_name_lower (name_lower),
  KEY ix_teams_captain (captain_id),
  KEY ix_teams_created (created_at),
  CONSTRAINT fk_teams_captain FOREIGN KEY (captain_id) REFERENCES users (id),
  CONSTRAINT chk_teams_name CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE team_members (
  team_id     VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(128) NOT NULL,
  role        ENUM('starter','sub') NOT NULL DEFAULT 'starter',
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  joined_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (team_id, user_id),
  KEY ix_team_members_user (user_id),
  CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE team_invites (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id          VARCHAR(64)  NOT NULL,
  phone            VARCHAR(20)  NOT NULL,
  invited_user_id  VARCHAR(128) NULL COMMENT 'registered user owning the phone when invited',
  invited_by       VARCHAR(128) NOT NULL,
  status           ENUM('pending','accepted','declined','revoked') NOT NULL DEFAULT 'pending',
  created_at       DATETIME(3)  NOT NULL,
  responded_at     DATETIME(3)  NULL,
  -- NULL unless pending, so the unique key allows only ONE pending invite per (team, phone)
  pending_phone    VARCHAR(20)  GENERATED ALWAYS AS (IF(status = 'pending', phone, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_invites_pending (team_id, pending_phone),
  KEY ix_team_invites_phone (phone, status),
  CONSTRAINT fk_team_invites_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_invites_user FOREIGN KEY (invited_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_team_invites_by FOREIGN KEY (invited_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE tournaments (
  id             VARCHAR(64)  NOT NULL,
  name           VARCHAR(80)  NOT NULL,
  organizer_id   VARCHAR(128) NOT NULL,
  format         ENUM('knockout','league') NOT NULL,
  rule_set_id    BIGINT UNSIGNED NOT NULL,
  start_date     DATETIME(3)  NOT NULL,
  end_date       DATETIME(3)  NOT NULL,
  location_name  VARCHAR(160) NOT NULL,
  location_lat   DECIMAL(9,6) NOT NULL,
  location_lng   DECIMAL(9,6) NOT NULL,
  status         ENUM('registration','running','finished') NOT NULL DEFAULT 'registration',
  created_at     DATETIME(3)  NOT NULL,
  updated_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_tournaments_start (start_date),
  KEY ix_tournaments_organizer (organizer_id),
  CONSTRAINT fk_tournaments_organizer FOREIGN KEY (organizer_id) REFERENCES users (id),
  CONSTRAINT fk_tournaments_rules FOREIGN KEY (rule_set_id) REFERENCES rule_sets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE tournament_teams (
  tournament_id  VARCHAR(64)  NOT NULL,
  team_key       VARCHAR(64)  NOT NULL COMMENT 'id used inside fixtures: a teams.id or an external (ext_*) team',
  team_id        VARCHAR(64)  NULL COMMENT 'set when team_key is a registered team',
  name           VARCHAR(60)  NOT NULL,
  color          VARCHAR(16)  NOT NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, team_key),
  KEY ix_tournament_teams_team (team_id),
  CONSTRAINT fk_tournament_teams_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
  CONSTRAINT fk_tournament_teams_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE matches (
  id                   VARCHAR(64)  NOT NULL,
  title                VARCHAR(120) NULL,
  rule_set_id          BIGINT UNSIGNED NOT NULL,
  first_serve          ENUM('A','B') NOT NULL DEFAULT 'A',
  status               ENUM('scheduled','live','finished','abandoned') NOT NULL,
  created_by           VARCHAR(128) NOT NULL,
  scorer_id            VARCHAR(128) NOT NULL COMMENT 'the only user allowed to change the score',
  location_name        VARCHAR(160) NULL,
  location_lat         DECIMAL(9,6) NULL,
  location_lng         DECIMAL(9,6) NULL,
  scheduled_at         DATETIME(3)  NULL,
  started_at           DATETIME(3)  NULL,
  finished_at          DATETIME(3)  NULL,
  tournament_id        VARCHAR(64)  NULL,
  fixture_key          VARCHAR(64)  NULL,
  challenge_id         VARCHAR(64)  NULL,
  stream_provider      ENUM('none','rtmp','webrtc','youtube') NULL,
  stream_playback_url  VARCHAR(1024) NULL,
  stream_ingest_url    VARCHAR(1024) NULL COMMENT 'never returned to followers',
  stream_live          TINYINT(1)   NULL,
  event_count          INT UNSIGNED NOT NULL DEFAULT 0,
  version              INT UNSIGNED NOT NULL DEFAULT 0,
  summary              JSON         NOT NULL COMMENT 'denormalised cache of sets/points (rebuilt from the event log)',
  created_at           DATETIME(3)  NOT NULL,
  updated_at           DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_matches_status_updated (status, updated_at),
  KEY ix_matches_tournament (tournament_id),
  KEY ix_matches_scorer (scorer_id),
  KEY ix_matches_created_by (created_by),
  CONSTRAINT fk_matches_rules FOREIGN KEY (rule_set_id) REFERENCES rule_sets (id),
  CONSTRAINT fk_matches_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_matches_scorer FOREIGN KEY (scorer_id) REFERENCES users (id),
  CONSTRAINT fk_matches_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE fixtures (
  tournament_id  VARCHAR(64) NOT NULL,
  fixture_key    VARCHAR(64) NOT NULL,
  round          SMALLINT UNSIGNED NOT NULL,
  idx            SMALLINT UNSIGNED NOT NULL,
  home_key       VARCHAR(64) NULL,
  away_key       VARCHAR(64) NULL,
  home_from      VARCHAR(64) NULL COMMENT 'knockout: winner of this fixture fills home',
  away_from      VARCHAR(64) NULL,
  match_id       VARCHAR(64) NULL,
  PRIMARY KEY (tournament_id, fixture_key),
  UNIQUE KEY uq_fixtures_slot (tournament_id, round, idx),
  KEY ix_fixtures_match (match_id),
  CONSTRAINT fk_fixtures_tournament FOREIGN KEY (tournament_id) REFERENCES tournaments (id) ON DELETE CASCADE,
  CONSTRAINT fk_fixtures_home FOREIGN KEY (tournament_id, home_key) REFERENCES tournament_teams (tournament_id, team_key),
  CONSTRAINT fk_fixtures_away FOREIGN KEY (tournament_id, away_key) REFERENCES tournament_teams (tournament_id, team_key),
  CONSTRAINT fk_fixtures_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE match_sides (
  match_id  VARCHAR(64) NOT NULL,
  side      ENUM('A','B') NOT NULL,
  team_id   VARCHAR(64) NULL,
  name      VARCHAR(60) NOT NULL,
  color     VARCHAR(16) NOT NULL,
  PRIMARY KEY (match_id, side),
  KEY ix_match_sides_team (team_id),
  CONSTRAINT fk_match_sides_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_match_sides_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE match_players (
  match_id    VARCHAR(64)  NOT NULL,
  player_key  VARCHAR(140) NOT NULL COMMENT 'user id, or guest:<n> for unregistered players',
  side        ENUM('A','B') NOT NULL,
  user_id     VARCHAR(128) NULL,
  name        VARCHAR(60)  NOT NULL,
  photo_url   VARCHAR(1024) NULL,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_key),
  KEY ix_match_players_user (user_id),
  KEY ix_match_players_side (match_id, side),
  CONSTRAINT fk_match_players_side FOREIGN KEY (match_id, side) REFERENCES match_sides (match_id, side) ON DELETE CASCADE,
  CONSTRAINT fk_match_players_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE match_participants (
  match_id  VARCHAR(64)  NOT NULL,
  user_id   VARCHAR(128) NOT NULL,
  PRIMARY KEY (match_id, user_id),
  KEY ix_match_participants_user (user_id, match_id),
  CONSTRAINT fk_match_participants_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_match_participants_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE play_requests (
  match_id    VARCHAR(64)  NOT NULL,
  user_id     VARCHAR(128) NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (match_id, user_id),
  KEY ix_play_requests_user (user_id),
  CONSTRAINT fk_play_requests_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_play_requests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE sets (
  match_id     VARCHAR(64) NOT NULL,
  set_number   TINYINT UNSIGNED NOT NULL,
  score_a      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  score_b      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  winner       ENUM('A','B') NULL COMMENT 'NULL while the set is in progress',
  timeouts_a   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  timeouts_b   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  rotations_a  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  rotations_b  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, set_number),
  CONSTRAINT fk_sets_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT chk_sets_number CHECK (set_number BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE points (
  match_id      VARCHAR(64)  NOT NULL,
  seq           INT UNSIGNED NOT NULL COMMENT 'position in the event log, shared with timeouts',
  set_number    TINYINT UNSIGNED NOT NULL,
  side          ENUM('A','B') NOT NULL COMMENT 'team that won the rally',
  player_key    VARCHAR(140) NULL COMMENT 'optional credited player',
  kind          ENUM('kill','block','ace','tip') NULL,
  serving_side  ENUM('A','B') NOT NULL COMMENT 'team that served this rally',
  server_key    VARCHAR(140) NULL COMMENT 'player in position 1 of the serving team (rotation)',
  at            DATETIME(3)  NOT NULL,
  PRIMARY KEY (match_id, seq),
  KEY ix_points_player (match_id, player_key),
  CONSTRAINT fk_points_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE timeouts (
  match_id    VARCHAR(64)  NOT NULL,
  seq         INT UNSIGNED NOT NULL,
  set_number  TINYINT UNSIGNED NOT NULL,
  side        ENUM('A','B') NOT NULL,
  at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (match_id, seq),
  CONSTRAINT fk_timeouts_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE set_lineups (
  match_id    VARCHAR(64)  NOT NULL,
  set_number  TINYINT UNSIGNED NOT NULL,
  side        ENUM('A','B') NOT NULL,
  position    TINYINT UNSIGNED NOT NULL COMMENT 'court position 1-6 (1 = right back, serves)',
  player_key  VARCHAR(140) NULL COMMENT 'NULL = empty position',
  PRIMARY KEY (match_id, set_number, side, position),
  UNIQUE KEY uq_set_lineups_player (match_id, set_number, player_key),
  CONSTRAINT fk_set_lineups_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_set_lineups_player FOREIGN KEY (match_id, player_key) REFERENCES match_players (match_id, player_key) ON DELETE CASCADE,
  CONSTRAINT chk_set_lineups_position CHECK (position BETWEEN 1 AND 6),
  CONSTRAINT chk_set_lineups_set CHECK (set_number BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE match_photos (
  id            VARCHAR(64)  NOT NULL,
  match_id      VARCHAR(64)  NOT NULL,
  uploaded_by   VARCHAR(128) NOT NULL,
  storage_key   VARCHAR(255) NOT NULL,
  content_type  VARCHAR(64)  NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  created_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_match_photos_key (storage_key),
  KEY ix_match_photos_match (match_id, created_at),
  CONSTRAINT fk_match_photos_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
  CONSTRAINT fk_match_photos_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT chk_match_photos_size CHECK (size_bytes > 0 AND size_bytes < 10485760),
  CONSTRAINT chk_match_photos_type CHECK (content_type LIKE 'image/%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE challenges (
  id               VARCHAR(64)  NOT NULL,
  from_team_id     VARCHAR(64)  NOT NULL,
  to_team_id       VARCHAR(64)  NOT NULL,
  from_captain_id  VARCHAR(128) NOT NULL,
  to_captain_id    VARCHAR(128) NOT NULL,
  from_team_name   VARCHAR(40)  NOT NULL COMMENT 'snapshot at creation',
  to_team_name     VARCHAR(40)  NOT NULL,
  scheduled_for    DATETIME(3)  NOT NULL,
  location_name    VARCHAR(160) NOT NULL,
  location_lat     DECIMAL(9,6) NOT NULL,
  location_lng     DECIMAL(9,6) NOT NULL,
  message          VARCHAR(500) NULL,
  rule_set_id      BIGINT UNSIGNED NOT NULL,
  status           ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  match_id         VARCHAR(64)  NULL,
  created_at       DATETIME(3)  NOT NULL,
  responded_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_challenges_from (from_team_id),
  KEY ix_challenges_to (to_team_id),
  CONSTRAINT fk_challenges_from_team FOREIGN KEY (from_team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenges_to_team FOREIGN KEY (to_team_id) REFERENCES teams (id) ON DELETE CASCADE,
  CONSTRAINT fk_challenges_from_captain FOREIGN KEY (from_captain_id) REFERENCES users (id),
  CONSTRAINT fk_challenges_to_captain FOREIGN KEY (to_captain_id) REFERENCES users (id),
  CONSTRAINT fk_challenges_rules FOREIGN KEY (rule_set_id) REFERENCES rule_sets (id),
  CONSTRAINT fk_challenges_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE SET NULL,
  CONSTRAINT chk_challenges_teams CHECK (from_team_id <> to_team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
ALTER TABLE matches
  ADD CONSTRAINT fk_matches_challenge FOREIGN KEY (challenge_id) REFERENCES challenges (id) ON DELETE SET NULL;
-- ;;
CREATE TABLE courts (
  id             VARCHAR(64)  NOT NULL,
  name           VARCHAR(80)  NOT NULL,
  location_name  VARCHAR(160) NOT NULL,
  location_lat   DECIMAL(9,6) NOT NULL,
  location_lng   DECIMAL(9,6) NOT NULL,
  surface        ENUM('indoor','beach','grass','outdoor') NOT NULL,
  added_by       VARCHAR(128) NOT NULL,
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_courts_geo (location_lat, location_lng),
  CONSTRAINT fk_courts_added_by FOREIGN KEY (added_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
