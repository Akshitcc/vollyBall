-- VolleyLive 0022 (build 1.4.21, QA V1420-4): the support message limit is 2000 VISIBLE characters (what the app's
-- counter shows and where the field cuts – Hindi conjuncts and emoji count as one). One visible character can be
-- several code points, so the column only WIDENS (2000 → 8000 code points). Nothing is dropped or shortened; every
-- stored row stays valid; 1.4.20 servers keep working against it. Re-run safe (MODIFY to the same type is a no-op).
-- ;;
ALTER TABLE support_tickets MODIFY COLUMN message VARCHAR(8000) NOT NULL COMMENT 'plain text 10..2000 visible characters (≤ 8000 code points), hidden characters stripped';
