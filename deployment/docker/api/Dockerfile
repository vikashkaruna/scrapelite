# deployment/docker/api/Dockerfile — the function-compat API image.
# Same image runs the api (public /api/*) and jobs (scheduled-only, token-gated)
# services with different commands — mirroring the GCP pattern where both Cloud
# Run services reuse one Artifact Registry image (doc 05 §3a).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
# Netlify's esbuild bundler resolves these at deploy; the image must too.
RUN npm ci --omit=dev --no-audit --no-fund
COPY netlify.toml ./
COPY netlify/functions ./netlify/functions
# several functions import shared modules from src/lib (ai.js, discoverability.js,
# engagement-webhook.js, …) — Netlify's bundler inlines them, the image ships them
COPY src/lib ./src/lib
COPY deployment/adapter ./adapter
COPY deployment/scripts/gen-routes-manifest.mjs /tmp/gen-routes-manifest.mjs
RUN node /tmp/gen-routes-manifest.mjs \
      --functions-dir /app/netlify/functions \
      --toml /app/netlify.toml \
      --out /app/adapter/routes.manifest.json
USER node
EXPOSE 8080
# MODE is provided by the compose service command: "api" (default) or "jobs".
CMD ["node", "adapter/server.mjs", "api"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
