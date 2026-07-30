CREATE TABLE IF NOT EXISTS offline_keys (
    id          SERIAL PRIMARY KEY,
    org         TEXT NOT NULL,
    key         TEXT NOT NULL,
    seats       INTEGER NOT NULL DEFAULT 999,
    expires_at  TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offline_keys_created ON offline_keys(created_at DESC);