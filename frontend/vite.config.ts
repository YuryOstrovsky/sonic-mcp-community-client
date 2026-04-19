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
        manualChunks: {
          reactflow: ["reactflow"],
          icons:   ["lucide-react"],
          misc:    ["cmdk", "sonner", "@tanstack/react-virtual"],
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
});
