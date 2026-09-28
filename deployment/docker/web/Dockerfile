# deployment/docker/web/Dockerfile — public web surface: SPA + prerendered
# pages + help site + SEO assets. Mirrors the Firebase-Hosting static payload:
# prerendered files win over the SPA catch-all; / is forced to /home/index.html;
# /admin is NOT served here (own container).
FROM nginx:1.29-alpine
COPY deployment/docker/web/nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
