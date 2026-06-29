import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
