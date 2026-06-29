import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { Plugin } from "vite";

// Vite-конфиг для desktop (Tauri) сборки.
// Защита кода:
//  1. minify: "terser" — агрессивное минифицирование + переименование переменных
//  2. Кастомный плагин antiDebug — инжектирует anti-devtools код
//  3. Кастомный плагин stringObfuscator — разбивает строки на сегменты
//  4. define — подменяет URL backend на localhost:54321

const LOCAL_SERVER = "http://127.0.0.1:54321";

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
    // Terser — агрессивное сжатие и переименование
    minify: "terser",
    terserOptions: {
      compress: {
        // Удаляет console.log, предупреждения
        drop_console: true,
        drop_debugger: false,   // debugger нужен для anti-debug ловушки
        passes: 3,              // 3 прохода компрессии
        dead_code: true,
        collapse_vars: true,
        reduce_vars: true,
        pure_funcs: ["console.info", "console.warn", "console.debug"],
      },
      mangle: {
        // Переименовывает все переменные/функции в короткие имена
        toplevel: true,
        eval: true,
        properties: {
          // Переименовывает свойства объектов (кроме зарезервированных)
          regex: /^_[a-z]/,   // только _camelCase свойства (внутренние)
        },
      },
      format: {
        // Убирает комментарии, пробелы, переводы строк
        comments: false,
        beautify: false,
        ascii_only: true,       // Все unicode → \uXXXX
      },
    },
    rollupOptions: {
      output: {
        // Разбиваем на чанки — затрудняет понимание структуры
        manualChunks(id) {
          if (id.includes("node_modules/react")) return "r";
          if (id.includes("node_modules/@radix-ui")) return "x";
          if (id.includes("node_modules/recharts")) return "c";
          if (id.includes("node_modules/exceljs") || id.includes("node_modules/jspdf")) return "d";
          if (id.includes("node_modules/")) return "v";
        },
        // Короткие имена файлов (без семантики)
        chunkFileNames: "a/[hash].js",
        entryFileNames: "e/[hash].js",
        assetFileNames: "s/[hash].[ext]",
      },
    },
    // Не генерировать sourcemap — исключает возможность восстановления кода
    sourcemap: false,
    // Предупреждения о размере чанков (10MB для большого приложения)
    chunkSizeWarningLimit: 10000,
  },
});