import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { Plugin } from "vite";

const LOCAL_SERVER = "http://127.0.0.1:54321";

// Вставляет hash-редирект в index.html для работы с file:// протоколом
function hashRouterPlugin(): Plugin {
  return {
    name: "hash-router-inject",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<script",
        `<script>if(!location.hash||location.hash==='#')location.hash='#/';</script><script`
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), hashRouterPlugin()],
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
    outDir: "dist-electron",
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 10000,
  },
});
