import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { Plugin } from "vite";

// Vite-конфиг для desktop (Tauri) сборки.
// Защита кода:
//  1. minify: "terser" — агрессивное минифицирование + переименование переменных
//  2. Кастомный плагин antiDebug — инжектирует anti-devtools код
//  3. Кастомный плагин stringObfuscator — разбивает строки на сегменты
//  4. define — подменяет URL backend на localhost:5173

const LOCAL_SERVER = "http://127.0.0.1:5173";

// ── Плагин: Anti-DevTools + Self-Defend ───────────────────────────────────────
// Вставляет в начало каждого JS-чанка код, который:
// - Детектит открытые DevTools и разрушает работу при попытке инспекции
// - Использует ловушку через getter debugger
function antiDebugPlugin(): Plugin {
  const guardCode = `
(function(){
  var _0xguard=function(){
    var _d=new Date();
    debugger;
    if(new Date()-_d>100){
      document.body.innerHTML='';
      window.location.reload();
    }
  };
  var _t=setInterval(function(){
    _0xguard();
  },1000);
  var _e=new Image();
  Object.defineProperty(_e,'id',{get:function(){
    clearInterval(_t);
    document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#666">Приложение закрыто</div>';
  }});
})();
`.replace(/\n/g, "");

  return {
    name: "anti-debug",
    apply: "build",
    generateBundle(_opts, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && fileName.endsWith(".js")) {
          chunk.code = guardCode + chunk.code;
        }
      }
    },
  };
}

// ── Плагин: Строковый обфускатор ─────────────────────────────────────────────
// Заменяет строки вида "hello" на конкатенацию сегментов через функцию-декодер.
// Предотвращает grep по исходному коду в бинарнике.
function stringObfuscatorPlugin(): Plugin {
  return {
    name: "string-obfuscator",
    apply: "build",
    generateBundle(_opts, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk" && fileName.endsWith(".js")) {
          // Разбиваем длинные строковые литералы (>8 символов) на части
          chunk.code = chunk.code.replace(
            /"([^"\\]{8,64})"/g,
            (_match: string, s: string) => {
              if (s.includes("http") || s.includes("127.0.0.1")) return `"${s}"`;
              const mid = Math.floor(s.length / 2);
              const a = s.slice(0, mid);
              const b = s.slice(mid);
              return `("${a}"+"${b}")`;
            }
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  define: {
    __DESKTOP_SERVER__: JSON.stringify(LOCAL_SERVER),
    __IS_DESKTOP__: JSON.stringify(true),
  },
  build: {
    outDir: "dist-desktop",
    emptyOutDir: true,
    minify: "esbuild",
    // ── Разделение сборки на части (ускоряет открытие окна) ─────────────────
    // Раньше весь интерфейс лежал в одном файле ~3,4 МБ и читался с диска
    // целиком при каждом запуске. Теперь тяжёлые библиотеки вынесены в
    // отдельные части и подгружаются только когда действительно нужны:
    // выгрузка в Excel — в момент экспорта, PDF — при печати, графики — при
    // открытии депрессиограммы, админ-панель — только при заходе в неё.
    //
    // Рабочий экран со схемой вентиляции намеренно НЕ дробится: он нужен сразу
    // при запуске, дробление лишь добавило бы задержку на главном сценарии.
    // ВАЖНО: manualChunks задаётся ФУНКЦИЕЙ, а не объектом.
    // Сборка идёт на rolldown-vite, а rolldown (в отличие от rollup) объектную
    // форму { "имя-части": [пакеты] } не поддерживает: сборка десктопа падала с
    // «TypeError: manualChunks is not a function» уже после трансформации
    // модулей. Функция получает путь модуля и возвращает имя части — этот
    // вариант понимают оба сборщика.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-[^\\/]+)[\\/]/.test(id)) {
            return "vendor-charts";
          }
          if (/[\\/]node_modules[\\/](jspdf|canvg|dompurify|html2canvas)[\\/]/.test(id)) {
            return "vendor-pdf";
          }
        },
      },
    },
    // Не генерировать sourcemap — исключает возможность восстановления кода
    sourcemap: false,
    // Предупреждения о размере чанков (10MB для большого приложения)
    chunkSizeWarningLimit: 10000,
  },
});