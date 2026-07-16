-- Мониторинг лицензий: версия приложения, IP, используемые модули на месте
ALTER TABLE license_seats
  ADD COLUMN IF NOT EXISTS app_version  VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS last_ip      VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS last_modules TEXT NULL;

-- Журнал событий лицензий (входы, нарушения лимита, использование модулей, отзыв)
CREATE TABLE IF NOT EXISTS license_events (
  id           SERIAL PRIMARY KEY,
  license_id   INT NULL,
  license_key  VARCHAR(32) NULL,
  seat_id      INT NULL,
  event_type   VARCHAR(40) NOT NULL,
  fingerprint  VARCHAR(128) NULL,
  hostname     TEXT NULL,
  platform     TEXT NULL,
  app_version  VARCHAR(32) NULL,
  ip           VARCHAR(64) NULL,
  detail       TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_events_lic    ON license_events(license_id);
CREATE INDEX IF NOT EXISTS idx_license_events_type   ON license_events(event_type);
CREATE INDEX IF NOT EXISTS idx_license_events_time   ON license_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seats_last_seen       ON license_seats(last_seen_at DESC);