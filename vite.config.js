import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Proxy /api/* to the Netlify dev server (port 8888) during local development.
    // Run `netlify dev` instead of `npm run dev` to spin up both the Vite
    // server and the Netlify Functions together at http://localhost:8888.
    // This proxy is a convenience for `npm run dev` — it forwards API calls
    // to Netlify dev if it happens to be running alongside.
    proxy: {
      "/api": {
        target: "http://localhost:8888",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api/, "/.netlify/functions"),
      },
    },
  },
});
