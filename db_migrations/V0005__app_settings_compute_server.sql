CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES
    ('compute_active', 'primary'),
    ('compute_backup_url', ''),
    ('compute_autofailover', '1')
ON CONFLICT (key) DO NOTHING;