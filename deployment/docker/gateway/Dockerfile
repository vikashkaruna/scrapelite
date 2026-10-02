# deployment/docker/gateway/Dockerfile — the local edge (the Firebase-Hosting
# stand-in): 301 redirects + baseline headers + upstream routing, all generated
# from netlify.toml + scripts/site-routes.mjs at build time. Upstream hosts and
# the listen port arrive as env vars (official-image templates envsubst).
FROM node:24-slim AS conf
WORKDIR /build
COPY netlify.toml ./
COPY scripts/site-routes.mjs ./scripts/site-routes.mjs
COPY deployment/gateway/gen-gateway-conf.mjs ./deployment/gateway/gen-gateway-conf.mjs
RUN SITE_ROUTES_FILE=/build/scripts/site-routes.mjs \
    NETLIFY_TOML_FILE=/build/netlify.toml \
    node deployment/gateway/gen-gateway-conf.mjs --out /out

FROM nginx:1.29-alpine
COPY --from=conf /out/nginx.conf /etc/nginx/nginx.conf
COPY --from=conf /out/conf.d/baseline.inc /etc/nginx/conf.d/baseline.inc
COPY --from=conf /out/templates/datiq.conf.template /etc/nginx/templates/datiq.conf.template
EXPOSE 8080
