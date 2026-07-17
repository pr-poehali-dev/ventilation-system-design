-- Версия расчётного ядра (server.exe) на рабочем месте — для мониторинга.
ALTER TABLE license_seats
  ADD COLUMN IF NOT EXISTS core_version VARCHAR(32) NULL;