-- 1.4.27 (Akshit, E2E-4): "Groups + knockout" tournaments, up to 32 teams. Additive and re-runnable:
-- tournaments.format gains 'groups' (an ENUM value appended at the end: existing rows unchanged), plus nullable
-- columns for the group of a team / fixture, the seeded knockout slots and the number of teams per group advancing.
ALTER TABLE tournaments MODIFY format ENUM('knockout','league','groups') NOT NULL
-- ;;
SET @vl0024_0 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tournaments' AND column_name = 'advance');
-- ;;
SET @vl0024_0s = IF(@vl0024_0 = 0, 'ALTER TABLE tournaments ADD COLUMN advance TINYINT UNSIGNED NULL COMMENT ''groups format: teams per group that go to the knockout (1.4.27)'' AFTER format', 'DO 0');
-- ;;
PREPARE vl0024_stmt FROM @vl0024_0s;
-- ;;
EXECUTE vl0024_stmt;
-- ;;
DEALLOCATE PREPARE vl0024_stmt;
-- ;;
SET @vl0024_1 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tournament_teams' AND column_name = 'group_key');
-- ;;
SET @vl0024_1s = IF(@vl0024_1 = 0, 'ALTER TABLE tournament_teams ADD COLUMN group_key CHAR(1) NULL COMMENT ''groups format: group letter A-H (1.4.27)'' AFTER color', 'DO 0');
-- ;;
PREPARE vl0024_stmt FROM @vl0024_1s;
-- ;;
EXECUTE vl0024_stmt;
-- ;;
DEALLOCATE PREPARE vl0024_stmt;
-- ;;
SET @vl0024_2 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'fixtures' AND column_name = 'group_key');
-- ;;
SET @vl0024_2s = IF(@vl0024_2 = 0, 'ALTER TABLE fixtures ADD COLUMN group_key CHAR(1) NULL COMMENT ''groups format: group of a group-stage fixture (1.4.27)'' AFTER away_from', 'DO 0');
-- ;;
PREPARE vl0024_stmt FROM @vl0024_2s;
-- ;;
EXECUTE vl0024_stmt;
-- ;;
DEALLOCATE PREPARE vl0024_stmt;
-- ;;
SET @vl0024_3 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'fixtures' AND column_name = 'home_seed');
-- ;;
SET @vl0024_3s = IF(@vl0024_3 = 0, 'ALTER TABLE fixtures ADD COLUMN home_seed VARCHAR(4) NULL COMMENT ''groups format: first knockout round slot filled by this group place, e.g. A1 (1.4.27)'' AFTER group_key', 'DO 0');
-- ;;
PREPARE vl0024_stmt FROM @vl0024_3s;
-- ;;
EXECUTE vl0024_stmt;
-- ;;
DEALLOCATE PREPARE vl0024_stmt;
-- ;;
SET @vl0024_4 = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'fixtures' AND column_name = 'away_seed');
-- ;;
SET @vl0024_4s = IF(@vl0024_4 = 0, 'ALTER TABLE fixtures ADD COLUMN away_seed VARCHAR(4) NULL COMMENT ''groups format (1.4.27)'' AFTER home_seed', 'DO 0');
-- ;;
PREPARE vl0024_stmt FROM @vl0024_4s;
-- ;;
EXECUTE vl0024_stmt;
-- ;;
DEALLOCATE PREPARE vl0024_stmt;
