# deployment/docker/admin/Dockerfile — the /admin surface as its own
# deployable (owner requirement, doc 04 FR-0). Serves the SPA shell for any
# /admin* path; assets come from the web surface via the gateway.
FROM nginx:1.29-alpine
COPY deployment/docker/admin/nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
