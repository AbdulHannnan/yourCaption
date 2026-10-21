import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal dev setup. The proxy forwards the backend's routes to the Express
// API on :4000 so the frontend can use plain relative URLs (and we don't have
// to add CORS to the backend).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/jobs": "http://localhost:4000",
      "/templates": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
  },
});
