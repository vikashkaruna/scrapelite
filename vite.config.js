import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    // Dev-only proxy so `npm run dev` (plain Vite) can reach Netlify Functions
    // served separately by `netlify functions:serve` (or `netlify dev`).
    // Target port is configurable via FUNCTIONS_DEV_PORT (default 9999, the port
    // used by `netlify functions:serve`). Ignored in production builds.
    // Useful in git worktrees where `netlify dev` resolves the wrong base dir.
    proxy: {
      // Frontend calls /.netlify/functions/* directly (see paymentService FUNCTIONS const)
      "/.netlify/functions": {
        target: `http://localhost:${process.env.FUNCTIONS_DEV_PORT || "9999"}`,
        changeOrigin: true,
      },
      // /api/* → /.netlify/functions/* (matches netlify.toml redirect)
      "/api": {
        target: `http://localhost:${process.env.FUNCTIONS_DEV_PORT || "9999"}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/.netlify/functions"),
      },
    },
  },
});
