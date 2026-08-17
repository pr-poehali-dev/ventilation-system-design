// ─────────────────────────────────────────────────────────────────────────────
// ServerTab.tsx — вкладка «Сервер расчёта» панели администратора: выбор
// активного расчётного сервера (основной / аварийный резерв), адрес резерва
// и автоматическое переключение при исчерпании лимита.
//
// Вынесено из Admin.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import Icon from "@/components/ui/icon";

interface ServerTabProps {
  srvActive: "primary" | "backup";
  setSrvActive: (v: "primary" | "backup") => void;
  srvBackupUrl: string;
  setSrvBackupUrl: (v: string) => void;
  srvAutofail: boolean;
  setSrvAutofail: (v: boolean) => void;
  srvCfgLoading: boolean;
  srvCfgSaving: boolean;
  srvCfgOk: boolean;
  srvCfgErr: string;
  saveServerCfg: () => void;
  switchServer: (target: "primary" | "backup") => void;
}

export default function ServerTab({
  srvActive, setSrvActive, srvBackupUrl, setSrvBackupUrl,
  srvAutofail, setSrvAutofail, srvCfgLoading, srvCfgSaving,
  srvCfgOk, srvCfgErr, saveServerCfg, switchServer,
}: ServerTabProps) {
  const [pingState, setPingState] = useState<"idle" | "run" | "ok" | "fail">("idle");
  const [pingMsg, setPingMsg] = useState("");

  const pingBackup = async () => {
    const base = srvBackupUrl.trim().replace(/\/+$/, "");
    if (!base) return;
    setPingState("run");
    setPingMsg("");

    // Облачная расчётная функция (второй аккаунт) не имеет страницы /health —
    // проверяем её пробным расчётом на пустой схеме: важен сам факт ответа.
    if (isCloudFunction) {
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "cross", nodes: [], branches: [] }),
        });
        if (res.ok) {
          setPingState("ok");
          setPingMsg("Облачный резерв отвечает — расчёты примет");
        } else {
          setPingState("fail");
          setPingMsg(`Сервер ответил ошибкой (код ${res.status}). Проверьте адрес функции`);
        }
      } catch {
        setPingState("fail");
        setPingMsg("Нет ответа. Проверьте, что адрес скопирован целиком и проект опубликован");
      }
      return;
    }

    try {
      const res = await fetch(`${base}/health`, { method: "GET" });
      const j = await res.json();
      if (res.ok && j?.ok) {
        setPingState("ok");
        setPingMsg("Резервный сервер отвечает, все расчёты загружены");
      } else {
        setPingState("fail");
        const miss = Object.entries(j?.functions ?? {})
          .filter(([, v]) => !v).map(([k]) => k).join(", ");
        setPingMsg(miss
          ? `Сервер отвечает, но не найдены расчёты: ${miss}`
          : "Сервер ответил ошибкой");
      }
    } catch {
      setPingState("fail");
      setPingMsg(mixedContent
        ? "Браузер заблокировал запрос: страница открыта по https, а сервер по http"
        : isPrivateIp
          ? "Адрес недоступен с этого компьютера — см. пояснение ниже"
          : "Нет ответа. Проверьте адрес, питание ПК и порт в брандмауэре");
    }
  };

  const onBackup = srvActive === "backup";

  // Главная причина «не подключается»: программа открыта по https, а резервный
  // сервер в локальной сети работает по http — браузер режет такие запросы.
  const pageIsHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const urlIsHttp = /^http:\/\//i.test(srvBackupUrl.trim());
  const mixedContent = pageIsHttps && urlIsHttp;

  // Адрес вида 192.168.x.x / 10.x.x.x / 172.16-31.x.x виден ТОЛЬКО внутри той же
  // локальной сети. Если сервер стоит на удалённом ПК (другой офис, подключение
  // по удалённому рабочему столу) — такой адрес недостижим в принципе.
  const isPrivateIp = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/i
    .test(srvBackupUrl.trim());

  // Адрес облачной расчётной функции второго аккаунта.
  const isCloudFunction = /functions\.poehali\.dev/i.test(srvBackupUrl.trim());

  return (
  <div className="max-w-xl mx-auto">
    {/* Текущий сервер + мгновенное ручное переключение */}
    <div className={`rounded-xl shadow-sm border p-4 mb-5 ${onBackup ? "bg-amber-50 border-amber-300" : "bg-green-50 border-green-300"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${onBackup ? "bg-amber-500" : "bg-green-500"} animate-pulse`} />
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase">Расчёты идут через</div>
            <div className={`text-[14px] font-bold ${onBackup ? "text-amber-700" : "text-green-700"}`}>
              {onBackup ? "Аварийный резервный сервер" : "Основной сервер"}
            </div>
          </div>
        </div>
        <button
          onClick={() => switchServer(onBackup ? "primary" : "backup")}
          disabled={srvCfgSaving || srvCfgLoading || (!onBackup && !srvBackupUrl.trim())}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-[12px] font-bold text-white shadow-sm disabled:opacity-50 transition-colors ${onBackup ? "bg-green-600 hover:bg-green-700" : "bg-amber-500 hover:bg-amber-600"}`}>
          {srvCfgSaving
            ? <><Icon name="Loader" size={14} className="animate-spin" />Переключаю...</>
            : <><Icon name="RefreshCw" size={14} />
                {onBackup ? "Вернуть на основной" : "Переключить на резерв"}</>}
        </button>
      </div>
      <div className="text-[10.5px] text-gray-500 mt-2">
        Переключение применяется сразу — все рабочие места подхватят его автоматически.
      </div>
    </div>

    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="Server" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>Расчётный сервер</span>
      </div>
      <p className="text-[11px] text-gray-400 mb-4">
        На случай, когда на основном сервере закончилось вычислительное время —
        переключите расчёты на аварийный резервный сервер. Все рабочие места
        подхватят изменение автоматически.
      </p>

      {srvCfgLoading ? (
        <span className="text-[12px] text-gray-400">Загрузка...</span>
      ) : (
        <div className="space-y-4">
          {/* Выбор активного сервера */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Активный сервер</div>
            <div className="flex gap-2">
              <button onClick={() => setSrvActive("primary")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${srvActive === "primary" ? "bg-green-600 text-white border-green-600" : "bg-white text-gray-600 border-gray-300 hover:border-green-400"}`}>
                <Icon name="CheckCircle2" size={14} />Основной
              </button>
              <button onClick={() => setSrvActive("backup")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors ${srvActive === "backup" ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-300 hover:border-amber-400"}`}>
                <Icon name="LifeBuoy" size={14} />Аварийный резерв
              </button>
            </div>
            {srvActive === "backup" && !srvBackupUrl.trim() && (
              <div className="text-[11px] text-red-500 mt-1">Укажите адрес резервного сервера ниже</div>
            )}
          </div>

          {/* Адрес резервного сервера */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Адрес аварийного сервера (URL)</div>
            <input value={srvBackupUrl} onChange={e => setSrvBackupUrl(e.target.value)}
              placeholder="https://192.168.0.179:8800/"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-[12px] font-mono text-gray-900 focus:outline-none focus:border-blue-400" />
            {!srvBackupUrl.trim() ? (
              <div className="text-[11px] text-amber-800 mt-1.5 bg-amber-50 border border-amber-300 rounded-lg px-2.5 py-2">
                <span className="font-semibold">Поле пустое.</span> Серый текст выше — это только
                пример, а не введённый адрес. Впишите сюда строку, которую показал
                резервный сервер в своём окне (раздел «АДРЕС ДЛЯ АДМИН-ПАНЕЛИ»).
              </div>
            ) : (
              <div className="text-[10px] text-gray-500 mt-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
                Адрес берётся из окна резервного сервера — строка
                «АДРЕС ДЛЯ АДМИН-ПАНЕЛИ», копируется целиком, вместе с
                <span className="font-mono"> https://</span> и портом.
              </div>
            )}

            {isCloudFunction && (
              <div className="text-[10.5px] text-green-800 mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <span className="font-semibold flex items-center gap-1.5 mb-0.5">
                  <Icon name="CloudCheck" size={13} />Облачный резерв
                </span>
                Верный тип адреса: доступен из любой точки, настройка сети и
                сертификаты не нужны. Нажмите «Проверить связь» и сохраните.
              </div>
            )}

            {isPrivateIp && pingState !== "ok" && (
              <div className="text-[10.5px] text-blue-800 mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                <div className="font-semibold mb-1 flex items-center gap-1.5">
                  <Icon name="Info" size={13} />Это внутренний адрес локальной сети
                </div>
                Он работает <span className="font-semibold">только на компьютерах, стоящих
                в одной сети с резервным сервером</span>. Если вы подключаетесь к тому ПК
                удалённо, ваш компьютер до этого адреса не достанет — проверка связи
                всегда будет неуспешной, даже когда сервер исправен.
                <br /><br />
                <span className="font-semibold">Как быть:</span>
                <br />• Все инженеры работают в той же сети, что и сервер — всё верно,
                проверьте связь с их компьютера.
                <br />• Пользователи по всей стране — внутренний адрес не подойдёт,
                нужен облачный резерв или внешний адрес (см. блок ниже).
              </div>
            )}

            {mixedContent && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-red-700 mb-1">
                  <Icon name="ShieldAlert" size={14} />
                  Браузер не пропустит этот адрес
                </div>
                <div className="text-[10.5px] text-red-700/90 leading-relaxed">
                  Программа открыта по защищённому адресу (https), а резервный сервер
                  работает по обычному http. Браузер блокирует такие запросы —
                  и «Проверить связь» всегда покажет «нет ответа», даже если сервер работает.
                  <br /><br />
                  <span className="font-semibold">Решение для закрытой сети:</span> на резервном
                  ПК остановите сервер и запустите <span className="font-mono">https\secure.bat</span>.
                  Он выдаст защищённый адрес вида <span className="font-mono">https://192.168.х.х:8800/</span> —
                  вставьте его в поле выше. Затем один раз откройте ссылку
                  «Открыть в браузере» и разрешите переход («Дополнительно» → «Перейти на сайт»).
                  <br /><br />
                  <span className="font-semibold">Если интернет на резервном ПК открыт:</span> проще
                  запустить <span className="font-mono">https\tunnel.bat</span> — он выдаст готовый
                  адрес, настраивать браузеры не нужно.
                  <br /><br />
                  В <span className="font-semibold">десктопной версии</span> программы ничего этого
                  не требуется — обычный адрес работает сразу.
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-2">
              <button onClick={pingBackup} disabled={!srvBackupUrl.trim() || pingState === "run"}
                title={!srvBackupUrl.trim() ? "Сначала впишите адрес резервного сервера" : ""}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-300 text-gray-600 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed">
                {pingState === "run"
                  ? <><Icon name="Loader" size={13} className="animate-spin" />Проверка...</>
                  : <><Icon name="Activity" size={13} />Проверить связь</>}
              </button>
              {pingState === "ok" && (
                <span className="text-[11px] text-green-600 flex items-center gap-1">
                  <Icon name="Check" size={13} />{pingMsg}
                </span>
              )}
              {pingState === "fail" && (
                <span className="text-[11px] text-red-500 flex items-center gap-1">
                  <Icon name="CircleAlert" size={13} />{pingMsg}
                </span>
              )}
              {srvBackupUrl.trim() && !isCloudFunction && (
                <a href={`${srvBackupUrl.trim().replace(/\/+$/, "")}/health`}
                  target="_blank" rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:underline flex items-center gap-1">
                  <Icon name="ExternalLink" size={12} />Открыть в браузере
                </a>
              )}
            </div>
          </div>

          {/* Автопереключение */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={srvAutofail}
              onChange={e => setSrvAutofail(e.target.checked)}
              className="mt-0.5" />
            <span className="text-[12px] text-gray-700">
              Автоматически переходить на резерв
              <span className="block text-[10px] text-gray-400">
                Если основной сервер ответит ошибкой лимита или будет недоступен,
                программа сама повторит расчёт на резервном сервере.
              </span>
            </span>
          </label>

          {srvCfgErr && <div className="text-[12px] text-red-500">{srvCfgErr}</div>}
          {srvCfgOk && <div className="text-[12px] text-green-600 flex items-center gap-1"><Icon name="Check" size={14} />Сохранено</div>}

          <button onClick={saveServerCfg} disabled={srvCfgSaving || (srvActive === "backup" && !srvBackupUrl.trim())}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ background: "#1a3a6b" }}>
            {srvCfgSaving ? <><Icon name="Loader" size={14} className="animate-spin" />Сохранение...</> : <><Icon name="Save" size={14} />Сохранить</>}
          </button>
        </div>
      )}
    </div>

    {/* Выбор сценария резервирования */}
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="Route" size={16} className="text-blue-500" />
        <span className="font-semibold text-[13px]" style={{ color: "#1a3a6b" }}>
          Какой резерв вам нужен
        </span>
      </div>

      <div className="rounded-lg border-2 border-green-300 bg-green-50 px-3.5 py-3 mb-3">
        <div className="text-[12px] font-bold text-green-800 mb-1">
          Пользователи по всей стране — второй облачный сервер
        </div>
        <div className="text-[11px] text-green-900/80 leading-relaxed">
          Резервом делается вторая копия программы в облаке на отдельном аккаунте.
          Адрес доступен из любой точки России, дежурный ПК и настройка сети
          не нужны, вычислительное время считается отдельно от основного.
        </div>

        <ol className="text-[11px] text-green-900/90 leading-relaxed mt-2.5 space-y-1.5 list-decimal pl-4">
          <li>Зарегистрируйте <span className="font-semibold">второй аккаунт</span> на
            платформе (другая почта — это важно, лимит времени считается по аккаунту).</li>
          <li>Создайте в нём новый проект и скажите ассистенту:
            <span className="italic"> «сделай копию расчётного сервера ПВ-Системы»</span> —
            либо перенесите код через GitHub из основного проекта.</li>
          <li>Дождитесь публикации. Расчётные функции получат свои адреса вида
            <span className="font-mono"> https://functions.poehali.dev/…</span></li>
          <li>Скопируйте адрес функции <span className="font-mono">airflow</span> —
            это и есть расчётный сервер.</li>
          <li>Вставьте его в поле «Адрес аварийного сервера» выше →
            «Проверить связь» → «Сохранить».</li>
        </ol>

        <div className="text-[10.5px] text-green-900/70 mt-2.5 pt-2 border-t border-green-200">
          Дальше ничего делать не нужно: при исчерпании лимита или сбое основного
          расчёты уйдут на резерв автоматически. Обновлять вторую копию достаточно
          раз в несколько месяцев, вместе с обновлением основной программы.
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 px-3.5 py-3 mb-4">
        <div className="text-[12px] font-semibold text-gray-700 mb-1">
          Все инженеры в одной сети с сервером — свой ПК
        </div>
        <div className="text-[11px] text-gray-600 leading-relaxed">
          Подходит для предприятия с общей локальной сетью или закрытого контура
          без интернета. Инструкция ниже. Чтобы такой сервер стал доступен
          снаружи, нужен проброс порта на роутере или туннель —
          подробности в файле <span className="font-mono">backup-server\https\README.md</span>.
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 pt-1 border-t border-gray-100">
        <Icon name="BookOpen" size={16} className="text-blue-500 mt-3" />
        <span className="font-semibold text-[13px] mt-3" style={{ color: "#1a3a6b" }}>
          Как поднять резерв на своём втором ПК
        </span>
      </div>
      <ol className="text-[11.5px] text-gray-600 space-y-2 list-decimal pl-4">
        <li>Скопируйте на второй ПК папку <span className="font-mono">backup-server</span> из
          комплекта программы (в ней уже лежат все расчётные модули).</li>
        <li>Установите Python 3.11 с python.org, отметив галочку
          «Add python.exe to PATH».</li>
        <li>Запустите <span className="font-mono">start.bat</span> — окно само поставит
          всё нужное и покажет список расчётов со статусом OK. Окно не закрывать.</li>
        <li>Откройте порт 8800 в брандмауэре Windows
          (Правила для входящих → Порт → TCP 8800 → Разрешить).</li>
        <li>Скопируйте адрес из окна сервера (строка «АДРЕС ДЛЯ АДМИН-ПАНЕЛИ») в поле выше,
          нажмите «Проверить связь», затем «Сохранить».</li>
      </ol>
      <div className="text-[11px] text-gray-600 mt-3 space-y-1 border-t border-gray-100 pt-3">
        <div className="font-semibold text-[11.5px]" style={{ color: "#1a3a6b" }}>Управление сервером на втором ПК</div>
        <div><span className="font-mono">run.bat</span> — обычный запуск (после первой установки)</div>
        <div><span className="font-mono">stop.bat</span> — остановить сервер</div>
        <div><span className="font-mono">autostart.bat</span> — включить/выключить автозапуск вместе с Windows</div>
      </div>
      <div className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
        Нужен доступ к этому серверу из других городов? Внутренний адрес не подойдёт.
        Варианты внешнего адреса — в файле
        <span className="font-mono"> backup-server\https\README.md</span>:
        проброс порта на роутере (постоянный адрес),
        <span className="font-mono"> tunnel-ngrok.bat</span> (работает через обычный порт 443,
        когда обычный туннель блокируется сетью).
      </div>
    </div>
  </div>
  );
}