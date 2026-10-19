import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Ports are allocated in C:\Claude\PORTS.md (frontend 5184, backend 4314).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5184,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4314" },
  },
});
