import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMachineInfo,
  loadCachedLicense,
  checkLicense,
  activateLicense,
  clearLicenseCache,
  checkOfflineEmergency,
  sendHeartbeat,
  storageReady,
  type LicenseInfo,
  type MachineInfo,
} from "@/lib/license";

export type LicenseStatus = "loading" | "demo" | "licensed" | "offline_expired";

export interface UseLicenseReturn {
  status: LicenseStatus;
  info: LicenseInfo | null;
  fingerprint: string;
  machineInfo: MachineInfo | null;
  activate: (key: string) => Promise<void>;
  deactivate: () => void;
  error: string | null;
}

export function useLicense(): UseLicenseReturn {
  const [status, setStatus]             = useState<LicenseStatus>("loading");
  const [info, setInfo]                 = useState<LicenseInfo | null>(null);
  const [fingerprint, setFingerprint]   = useState<string>("");
  const [machineInfo, setMachineInfo]   = useState<MachineInfo | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const machineInfoRef                  = useRef<MachineInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ── ШАГ 0. МГНОВЕННЫЙ СТАРТ ПО СОХРАНЁННОЙ ЛИЦЕНЗИИ ───────────────────
      // Раньше первым делом шли ожидания: чтение лицензии с диска и опрос
      // локального ядра за аппаратным номером ПК (до 3 секунд повторов), и лишь
      // потом поднимался сохранённый ключ. На руднике без интернета к этому
      // добавлялось ожидание ответа облака — запуск ощущался как зависание.
      //
      // Теперь сохранённую лицензию поднимаем СРАЗУ, синхронно из локального
      // хранилища, ещё до любых сетевых операций. Программа открыта и готова к
      // работе немедленно, а всё остальное доуточняется в фоне.
      const quick = loadCachedLicense();
      const quickEmergency = quick?.licensed ? null : checkOfflineEmergency();
      if (quick?.licensed) {
        setInfo(quick);
        setStatus("licensed");
      } else if (quickEmergency?.licensed) {
        setInfo(quickEmergency);
        setStatus("licensed");
      }

      // Дожидаемся восстановления лицензии с диска (десктоп), затем — fingerprint
      await storageReady;
      const mi = await getMachineInfo();
      if (cancelled) return;
      setFingerprint(mi.fingerprint);
      setMachineInfo(mi);
      machineInfoRef.current = mi;

      // 1. Смотрим кэш (после восстановления с диска он мог появиться —
      //    например, после чистки кэша WebView2, когда localStorage пуст).
      const cached = loadCachedLicense();
      if (cached?.licensed) {
        setInfo(cached);
        setStatus("licensed");
      }

      // 1a. Аварийный оффлайн-ключ (локальная проверка, без интернета) —
      // если обычной лицензии в кэше нет, но есть действующий аварийный ключ.
      const emergency = checkOfflineEmergency();
      if (!cached?.licensed && emergency?.licensed) {
        setInfo(emergency);
        setStatus("licensed");
      }

      // 2. Проверяем на сервере (обновляем сведения о ПК).
      //    К этому моменту программа УЖЕ открыта и работает по сохранённой
      //    лицензии, поэтому проверка идёт фоном и ничего не задерживает.
      //    Ожидание ответа ограничено по времени (см. checkLicense) — без
      //    интернета уходим на сохранённую лицензию за несколько секунд.
      try {
        const fresh = await checkLicense(mi.fingerprint, mi);
        if (cancelled) return;
        // Онлайн-лицензия в приоритете. Но если сервер её не подтвердил,
        // а аварийный ключ действует — остаёмся в аварийном режиме.
        if (!fresh.licensed && emergency?.licensed) {
          setInfo(emergency);
          setStatus("licensed");
          return;
        }
        setInfo(fresh);
        if (fresh.offlineExpired) {
          // Оффлайн-кэш просрочен — требуется подключение к интернету
          setStatus("offline_expired");
        } else {
          setStatus(fresh.licensed ? "licensed" : "demo");
        }
      } catch {
        if (cancelled) return;
        // Нет сети или истекло время ожидания — приоритет:
        // обычный кэш → аварийный ключ → демо.
        // Сохранённая лицензия при обрыве связи НЕ сбрасывается: человек
        // продолжает работать, как будто ничего не произошло.
        if (cached?.licensed) {
          setInfo(cached);
          setStatus("licensed");
        } else if (emergency?.licensed) {
          setInfo(emergency);
          setStatus("licensed");
        } else {
          setStatus("demo");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Периодический heartbeat («я на связи») ────────────────────────────────
  // Нужен только для мониторинга онлайн-сессий в админ-панели. На лимит рабочих
  // мест НЕ влияет: место занимается при активации и живёт в license_seats.
  //
  // ОПТИМИЗАЦИЯ ВЫЗОВОВ. Раньше сигнал уходил каждые 3 минуты безусловно —
  // 160 обращений за смену с каждого рабочего места, в том числе когда окно
  // свёрнуто и за программой никто не сидит.
  //
  // Теперь:
  //   • интервал 8 минут вместо 3 — вдвое с лишним реже;
  //   • пока вкладка скрыта (свернули окно, ушли на другую задачу) сигнал
  //     не отправляется вовсе;
  //   • при возвращении к программе сигнал уходит сразу, чтобы место мгновенно
  //     снова стало «онлайн».
  //
  // ВАЖНО: 8 минут выбраны не случайно. Админ-панель считает место онлайн, если
  // последний сигнал был не позже 10 минут назад (backend/admin-licenses,
  // online_minutes=10). Интервал обязан оставаться заметно меньше этого порога,
  // иначе работающие люди начнут мигать «офлайн». Увеличивать 8 минут можно
  // только вместе с порогом в админке.
  useEffect(() => {
    if (status !== "licensed" || !fingerprint) return;

    const HEARTBEAT_MS = 8 * 60 * 1000;
    let lastSentAt = 0;

    const ping = () => {
      lastSentAt = Date.now();
      sendHeartbeat(fingerprint, machineInfoRef.current ?? machineInfo ?? undefined);
    };

    // Первый сигнал — сразу, чтобы место появилось в мониторинге без задержки.
    ping();

    const tick = () => {
      // Вкладка скрыта — программа простаивает, сервер не тревожим.
      if (document.hidden) return;
      ping();
    };
    const id = setInterval(tick, HEARTBEAT_MS);

    // Вернулись к программе — отмечаемся, но не чаще, чем раз в интервал:
    // частые переключения между окнами не должны порождать поток запросов.
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - lastSentAt < HEARTBEAT_MS) return;
      ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, fingerprint, machineInfo]);

  const activate = useCallback(async (key: string) => {
    setError(null);
    const mi = machineInfoRef.current ?? await getMachineInfo();
    const result = await activateLicense(mi.fingerprint, key, mi);
    setInfo(result);
    setStatus("licensed");
  }, []);

  const deactivate = useCallback(() => {
    clearLicenseCache();
    setInfo(null);
    setStatus("demo");
  }, []);

  return { status, info, fingerprint, machineInfo, activate, deactivate, error };
}