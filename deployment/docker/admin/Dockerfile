# deployment/docker/admin/Dockerfile — the /admin surface as its own
# deployable (owner requirement, doc 04 FR-0). Serves the SPA shell for any
# /admin* path. The payload is the base=/admin/ build (dist-admin/, made by
# scripts/build-docker-web.mjs locally and the build-web-dist Cloud Build
# step remotely), so the HTML's asset URLs (/admin/assets/…) resolve back to
# THIS container through the /admin/** rewrite — never to the web surface's
# dist, whose entry hash can differ and blank the page.
FROM nginx:1.29-alpine
COPY deployment/docker/admin/nginx.conf /etc/nginx/nginx.conf
COPY dist-admin/ /usr/share/nginx/html/admin/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
