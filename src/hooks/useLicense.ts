import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMachineInfo,
  loadCachedLicense,
  checkLicense,
  activateLicense,
  clearLicenseCache,
  checkOfflineEmergency,
  isCheckDue,
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

      // 2. ЭКОНОМИЯ ОБРАЩЕНИЙ К СЕРВЕРУ.
      //    Раньше сервер опрашивался при КАЖДОМ запуске программы. У активных
      //    людей это десятки обращений в день (открыл-закрыл, перезагрузка,
      //    второе окно) — при том что ключ выдан на год и за сутки с ним ничего
      //    не происходит.
      //
      //    Теперь смотрим срок ключа: пока до окончания далеко, подтверждения
      //    достаточно раз в неделю. В остальные запуски программа работает по
      //    сохранённой лицензии и в сеть не выходит вовсе — заодно мгновенный
      //    старт на руднике без связи.
      if (!isCheckDue(cached) && cached?.licensed) {
        setInfo(cached);
        setStatus("licensed");
        return;
      }

      //    Проверяем на сервере (заодно обновляем сведения о ПК).
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
  // ОПТИМИЗАЦИЯ ВЫЗОВОВ. Изначально сигнал уходил каждые 3 минуты безусловно —
  // около 160 обращений за смену с каждого рабочего места, в том числе когда
  // окно свёрнуто и за программой никто не сидит. Затем интервал подняли до 8
  // минут, но и это давало ~60 обращений за смену на человека.
  //
  // Теперь:
  //   • интервал 30 минут — за смену около 16 сигналов вместо 60;
  //   • пока вкладка скрыта (свернули окно, ушли на другую задачу) сигнал
  //     не отправляется вовсе;
  //   • при возвращении к программе сигнал уходит сразу, чтобы место мгновенно
  //     снова стало «онлайн»;
  //   • первый сигнал — не чаще раза в интервал: перезапуски программы и второе
  //     окно больше не порождают поток обращений (метка времени хранится в
  //     localStorage и переживает перезагрузку).
  //
  // ВАЖНО: интервал связан с порогом «онлайн» в админ-панели
  // (backend/admin-licenses, online_minutes). Порог поднят до 45 минут — он
  // обязан оставаться заметно больше интервала, иначе работающие люди начнут
  // мигать «офлайн». Менять эти два числа можно только вместе.
  useEffect(() => {
    if (status !== "licensed" || !fingerprint) return;

    const HEARTBEAT_MS = 30 * 60 * 1000;
    const LAST_PING_KEY = "pvs_last_ping";

    const readLastPing = (): number => {
      try { return Number(localStorage.getItem(LAST_PING_KEY)) || 0; } catch { return 0; }
    };
    const ping = () => {
      try { localStorage.setItem(LAST_PING_KEY, String(Date.now())); } catch { /* ignore */ }
      sendHeartbeat(fingerprint, machineInfoRef.current ?? machineInfo ?? undefined);
    };

    // Первый сигнал — только если с прошлого прошло больше интервала. Раньше он
    // уходил при каждом запуске: частые перезапуски давали лишние обращения.
    if (Date.now() - readLastPing() >= HEARTBEAT_MS) ping();

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
      if (Date.now() - readLastPing() < HEARTBEAT_MS) return;
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