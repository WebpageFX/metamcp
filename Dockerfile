# syntax=docker/dockerfile:1.7
#
# Slim multi-stage build:
# - builder: node:20-bookworm-slim + native build tools (better-sqlite3)
# - runner:  node:20-bookworm-slim + uv binary only (no buildpack-deps / no full toolchain)
# - frontend: Next.js standalone (no pnpm / no full node_modules)
# - backend:  pnpm deploy --prod (pruned deps only)

ARG NODE_VERSION=20-bookworm-slim
ARG PNPM_VERSION=10.29.3

# uv/uvx binaries only (ARG cannot be used in COPY --from)
FROM ghcr.io/astral-sh/uv:0.8.4 AS uv

# -----------------------------------------------------------------------------
# Builder
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder

ARG PNPM_VERSION
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Dependency layer (cached unless lockfile / package.json change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/zod-types/package.json ./packages/zod-types/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm build

# Bump Next.js proxy timeout in traced/standalone copies
RUN set -e; \
    files="$(find node_modules apps/frontend/.next -path '*/next/dist/*/router-utils/proxy-request.js' -print 2>/dev/null || true)"; \
    if [ -z "$files" ]; then \
      echo "warn: next proxy-request.js not found; skipping timeout patch" >&2; \
    else \
      echo "$files" | while IFS= read -r f; do sed -i -e 's/30000/600000/' "$f"; done; \
    fi

# Portable production backend (prod deps only).
# Workspace package dist/ is gitignored, so pnpm deploy often omits it —
# copy built dist into the deployed @repo packages explicitly.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm --filter backend deploy --prod --legacy /app/backend-deploy \
    && cp -a /app/apps/backend/drizzle /app/backend-deploy/ \
    && cp /app/apps/backend/drizzle.config.ts /app/backend-deploy/ \
    && for pkg in zod-types trpc; do \
         dest="$(find /app/backend-deploy -type d -path "*/node_modules/@repo/${pkg}" | head -1)"; \
         if [ -n "$dest" ] && [ -d "/app/packages/${pkg}/dist" ]; then \
           rm -rf "${dest}/dist" && cp -a "/app/packages/${pkg}/dist" "${dest}/"; \
         fi; \
       done

# -----------------------------------------------------------------------------
# Runner (minimal)
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    PATH=/usr/local/bin:$PATH

LABEL org.opencontainers.image.source="https://github.com/fanywebfx/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="fanywebfx"

# curl for healthcheck; no python/make/g++ in runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# uv/uvx for STDIO MCP servers (binary only — not the heavy uv:debian image)
COPY --from=uv /uv /uvx /usr/local/bin/
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --home /home/nextjs nextjs \
    && mkdir -p /home/nextjs/.cache/node/corepack /home/nextjs/.cache/uv /data \
    && chown -R nextjs:nodejs /home/nextjs /data

# Next.js standalone server (includes traced node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public

# Backend deploy tree (dist + prod node_modules + drizzle)
COPY --from=builder --chown=nextjs:nodejs /app/backend-deploy ./apps/backend

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 12008

HEALTHCHECK --interval=30s --timeout=30s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:12008/health || exit 1

CMD ["./docker-entrypoint.sh"]
