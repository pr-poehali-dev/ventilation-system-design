// ─────────────────────────────────────────────────────────────────────────────
// CadTitleBar.tsx — строка заголовка окна программы: логотип, имя проекта,
// кнопки свернуть / развернуть / закрыть.
//
// Вынесено из Cad.tsx БЕЗ изменений разметки и поведения: те же стили, тексты,
// команды WebView2 и логика подтверждения закрытия несохранённого проекта.
// ─────────────────────────────────────────────────────────────────────────────
import AppLogo from "@/components/AppLogo";

interface CadTitleBarProps {
  projectFileName: string;
  isDirty: boolean;
  isEmptyProject: boolean;
  setShowAbout: (v: boolean) => void;
  setShowCloseConfirm: (v: boolean) => void;
}

export default function CadTitleBar({
  projectFileName, isDirty, isEmptyProject, setShowAbout, setShowCloseConfirm,
}: CadTitleBarProps) {
    // Универсальные функции управления окном: работают и через WebView2 и через postMessage
    type W = Window & { __pvsWinMinimize?: () => void; __pvsWinMaximize?: () => void; __pvsWinClose?: () => void; __pvsWinDrag?: () => void; __pvsWindowMaximized?: boolean; chrome?: { webview?: { postMessage: (s: string) => void } } };
    const w = window as W;
    const winMinimize = () => {
      if (typeof w.__pvsWinMinimize === "function") w.__pvsWinMinimize();
      else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-minimize" }));
    };
    const winMaximize = () => {
      if (typeof w.__pvsWinMaximize === "function") w.__pvsWinMaximize();
      else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-maximize" }));
    };
    const winClose = () => {
      if (isDirty && !isEmptyProject) { setShowCloseConfirm(true); return; }
      if (typeof w.__pvsWinClose === "function") w.__pvsWinClose();
      else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close" }));
    };
    const winDrag = () => {
      if (typeof w.__pvsWinDrag === "function") w.__pvsWinDrag();
      else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-drag" }));
    };
    const isMaximized = !!w.__pvsWindowMaximized;
    return (
  <div className="h-7 flex items-center select-none"
    style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)", borderBottom: "1px solid #b8b8b8" }}
    onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) return; winDrag(); }}
    onDoubleClick={winMaximize}>

    {/* Иконка + название — слева */}
    <div className="flex items-center gap-1.5 px-2 shrink-0">
      <button
        type="button"
        onClick={() => setShowAbout(true)}
        title="О программе"
        className="flex items-center justify-center hover:bg-black/10 rounded-sm p-0.5 transition-colors"
        style={{ lineHeight: 0 }}>
        <AppLogo className="w-4 h-4 object-contain" />
      </button>
      <span className="text-xs font-medium text-gray-700">ПВ-Система</span>
      {/* Пока проект не сохранён и не открыт из файла, имени нет — пишем
          «Новый проект» серым. Придумывать «Проект1.vproj» нельзя: файла с
          таким именем не существует, и пользователь ищет его на диске. */}
      <span className="text-xs text-gray-400">—</span>
      {projectFileName ? (
        <span className="text-xs font-semibold" style={{ color: "#1a3a6b" }}>
          {projectFileName}{isDirty ? " *" : ""}
        </span>
      ) : (
        <span className="text-xs" style={{ color: "#9ca3af" }}>
          Новый проект{isDirty ? " *" : ""}
        </span>
      )}
    </div>

    {/* Растяжка — drag-зона по центру */}
    <div className="flex-1 h-full" />

    {/* Кнопки управления окном — справа */}
    <div className="flex items-center h-full shrink-0">
      <button
        className="w-10 h-full hover:bg-black/10 flex items-center justify-center text-[11px] text-gray-600 transition-colors"
        title="Свернуть" onClick={winMinimize}>
        ─
      </button>
      <button
        className="w-10 h-full hover:bg-black/10 flex items-center justify-center text-[11px] text-gray-600 transition-colors"
        title={isMaximized ? "Восстановить" : "Развернуть"} onClick={winMaximize}>
        {isMaximized ? "❐" : "▢"}
      </button>
      <button
        className="w-10 h-full hover:bg-red-500 hover:text-white flex items-center justify-center text-[11px] text-gray-600 transition-colors"
        title="Закрыть" onClick={winClose}>
        ✕
      </button>
    </div>
  </div>
  );
}
