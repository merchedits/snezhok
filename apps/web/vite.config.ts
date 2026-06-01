import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      events: "events",
    },
  },
  define: {
    global: "globalThis",
    "process.env": {},
    process: {
      env: {}
    }
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
