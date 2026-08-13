-- Счётчик обращений к лицензионной службе по дням.
-- Нужен для контроля расхода вычислительного времени в облаке.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, а не подсчёт по license_events: журнал событий
-- намеренно пишется не чаще раза в сутки на рабочее место (экономия записей),
-- поэтому реальное число обращений по нему не посчитать. Здесь же на каждое
-- обращение увеличивается один счётчик — это одна строка на день и действие,
-- таблица не растёт и работает быстро.
CREATE TABLE IF NOT EXISTS license_usage_daily (
    day         DATE        NOT NULL,
    action      VARCHAR(20) NOT NULL,
    cnt         INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (day, action)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON license_usage_daily(day DESC);