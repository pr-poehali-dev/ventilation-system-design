CREATE TABLE licenses (
  id            SERIAL PRIMARY KEY,
  key           VARCHAR(32) UNIQUE NOT NULL,
  owner_name    VARCHAR(200) NOT NULL,
  owner_email   VARCHAR(200),
  max_seats     INT NOT NULL DEFAULT 5,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  notes         TEXT
);

CREATE TABLE license_seats (
  id             SERIAL PRIMARY KEY,
  license_id     INT NOT NULL REFERENCES licenses(id),
  fingerprint    VARCHAR(128) NOT NULL,
  activated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent     TEXT,
  UNIQUE(license_id, fingerprint)
);

CREATE INDEX idx_licenses_key        ON licenses(key);
CREATE INDEX idx_seats_fingerprint   ON license_seats(fingerprint);
CREATE INDEX idx_seats_license_id    ON license_seats(license_id);
