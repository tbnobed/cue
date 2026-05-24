# node:24-slim (Debian, glibc) instead of node:24-alpine (musl).
# pnpm-workspace.yaml's `overrides` block strips out musl native binaries
# (rollup-linux-x64-musl, lightningcss-linux-x64-musl, @tailwindcss/oxide-linux-x64-musl)
# because the Replit dev env is glibc and ships them via the gnu variants.
# Switching to a glibc base means we get the matching gnu binaries and the
# Vite/rollup build works without fighting the overrides.
FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-spec/orval.config.ts lib/api-spec/
COPY lib/api-spec/openapi.yaml lib/api-spec/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-client-react/tsconfig.json lib/api-client-react/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-zod/tsconfig.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY lib/db/tsconfig.json lib/db/
COPY lib/db/drizzle.config.ts lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/api-server/tsconfig.json artifacts/api-server/
COPY artifacts/studio-pm/package.json artifacts/studio-pm/
COPY artifacts/studio-pm/tsconfig.json artifacts/studio-pm/
COPY scripts/package.json scripts/
COPY scripts/tsconfig.json scripts/

# Install all deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source
COPY lib/ lib/
COPY artifacts/ artifacts/
COPY scripts/ scripts/

# Generate codegen
RUN pnpm --filter @workspace/api-spec run codegen

# Build frontend
WORKDIR /app/artifacts/studio-pm
RUN BASE_PATH=/ PORT=3000 pnpm run build

# Build API server
WORKDIR /app/artifacts/api-server
RUN pnpm run build

# Build the create-admin CLI into a self-contained bundle so the runner image
# doesn't need tsx/devDeps to seed the first admin at container start.
WORKDIR /app/scripts
RUN pnpm run build

# ─── Production image ────────────────────────────────────────────────────────
# Must match the base image's libc (glibc) — see comment on the base stage.
FROM node:24-slim AS runner
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-client-react/tsconfig.json lib/api-client-react/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-zod/tsconfig.json lib/api-zod/
COPY lib/db/package.json lib/db/
COPY lib/db/tsconfig.json lib/db/
COPY artifacts/api-server/package.json artifacts/api-server/
# studio-pm + mockup-sandbox are declared in pnpm-workspace.yaml (artifacts/*),
# so `pnpm install --frozen-lockfile` requires their manifests on disk to
# validate the lockfile, even though their node_modules aren't needed at
# runtime (the built dist/ is copied from the base stage below).
COPY artifacts/studio-pm/package.json artifacts/studio-pm/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY scripts/package.json scripts/
COPY scripts/tsconfig.json scripts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# Copy built outputs
COPY --from=base /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=base /app/artifacts/studio-pm/dist artifacts/studio-pm/dist
COPY --from=base /app/lib/api-zod/src/generated lib/api-zod/src/generated
COPY --from=base /app/lib/db/src lib/db/src
COPY --from=base /app/scripts/dist scripts/dist

# Container entrypoint: seed the bootstrap admin (idempotent — only runs when
# BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD are set), then exec the app.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
