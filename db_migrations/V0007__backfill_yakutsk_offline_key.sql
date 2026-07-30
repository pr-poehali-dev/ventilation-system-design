INSERT INTO offline_keys (org, key, seats, expires_at, is_active, notes, created_at)
SELECT
  'ООО Якутское Золото',
  'PVSO.eyJvcmciOiLQntCe0J4g0K_QutGD0YLRgdC60L7QtSDQl9C-0LvQvtGC0L4iLCJleHAiOiIyMDI3LTA2LTIwVDIzOjU5OjU5WiIsInNlYXRzIjo5OTksImlhdCI6IjIwMjYtMDctMjlUMTg6NTk6MzBaIn0.XcFDV8g6psNsvxR018qGmq8lHQXRur5sz8O_cjTDs5ePHzwcRVzqo838q0ATszfyqgpHS4fAODS66N02iR-GBg',
  999,
  '2027-06-20T23:59:59Z'::timestamptz,
  TRUE,
  'Добавлен в реестр вручную (выпущен до включения автосохранения)',
  '2026-07-29T18:59:30Z'::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM offline_keys WHERE org = 'ООО Якутское Золото'
);