# deployment/docker/trackers/Dockerfile — the tracker/config layer as its own
# deployable: analytics.js (consent-gated loader) + runtime-config.js (RENDERED
# from .env.<env> at deploy time by gen-local-config.mjs — compose bind-mounts
# the generated file over the copy in this image).
FROM nginx:1.29-alpine
COPY deployment/docker/trackers/nginx.conf /etc/nginx/nginx.conf
COPY public/analytics.js public/runtime-config.js /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
