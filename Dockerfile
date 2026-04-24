# syntax=docker/dockerfile:1.7
#
# Builds the PluginForge demo host app as a static site served by nginx.
# The plugin runtime is purely client-side — there's no server to run.
# In a real embedder, you'd load @pluginforge/core + @pluginforge/sdk
# directly into your own app instead of deploying this container.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/host-app/package.json packages/host-app/
COPY examples/hello-plugin/package.json examples/hello-plugin/
COPY examples/markdown-plugin/package.json examples/markdown-plugin/
COPY examples/todo-plugin/package.json examples/todo-plugin/
RUN npm ci --ignore-scripts

COPY packages packages
COPY examples examples

RUN npm -w @pluginforge/sdk run build \
 && npm -w @pluginforge/core run build \
 && npm -w @pluginforge/host-app run build

# ---- runner ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Sensible SPA defaults + strict CSP that permits blob: workers (required
# for PluginForge) while blocking foreign origins.
RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "no-referrer" always;
  # Allow blob: for worker creation (the sandbox needs it); disallow any
  # external script/frame/connect.
  add_header Content-Security-Policy "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self';" always;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location = /healthz {
    access_log off;
    return 200 "ok\n";
    default_type text/plain;
  }
}
EOF

COPY --from=builder /app/packages/host-app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
