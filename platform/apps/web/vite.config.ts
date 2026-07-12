import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/chat/",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/chat/api": { target: "http://localhost:3000", rewrite: (path) => path.replace(/^\/chat/, "") },
      "/chat/socket.io": { target: "http://localhost:3000", ws: true, rewrite: (path) => path.replace(/^\/chat/, "") },
    },
  },
  build: {
    sourcemap: true,
    target: "es2022",
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          realtime: ["socket.io-client"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
