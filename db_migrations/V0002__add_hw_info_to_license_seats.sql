ALTER TABLE license_seats
  ADD COLUMN IF NOT EXISTS hostname TEXT NULL,
  ADD COLUMN IF NOT EXISTS platform TEXT NULL,
  ADD COLUMN IF NOT EXISTS screen_info TEXT NULL,
  ADD COLUMN IF NOT EXISTS hw_fingerprint TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS license_seats_hw_fp_unique
  ON license_seats(license_id, hw_fingerprint)
  WHERE hw_fingerprint IS NOT NULL;