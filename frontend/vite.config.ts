import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5174",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split heavy, infrequently-touched libs off the main bundle so the
    // initial page load isn't dragging ~700 kB through on first paint.
    rollupOptions: {
      output: {
        // Function form (vite 8 / Rollup 4 no longer accepts the object map in
        // its types). Same effect: split these heavy libs into named chunks.
        manualChunks(id) {
          if (id.includes("/node_modules/reactflow/") || id.includes("/node_modules/@reactflow/")) return "reactflow";
          if (id.includes("/node_modules/lucide-react/")) return "icons";
          if (
            id.includes("/node_modules/cmdk/") ||
            id.includes("/node_modules/sonner/") ||
            id.includes("/node_modules/@tanstack/react-virtual/")
          ) return "misc";
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
});
