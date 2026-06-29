import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Vite-конфиг для desktop (Tauri) сборки.
// Отличия от dev-конфига:
//  1. Нет pp-tagger и HMR-плагинов
//  2. base = "./" — относительные пути (WebView открывает index.html как файл)
//  3. define — подменяем URL backend на localhost:54321
//  4. outDir — dist-desktop/

const LOCAL_SERVER = "http://127.0.0.1:54321";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  base: "./",
  define: {
    // Подменяем все URL облачных функций на локальный сервер.
    // В коде используется FUNC2URL из func2url.json и хардкод-константы.
    // Через define инжектим глобальную переменную __DESKTOP_SERVER__.
    __DESKTOP_SERVER__: JSON.stringify(LOCAL_SERVER),
    __IS_DESKTOP__: JSON.stringify(true),
  },
  build: {
    outDir: "dist-desktop",
    emptyOutDir: true,
    // Для Tauri WebView — без chunkhash-имён для стабильного кэширования
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
