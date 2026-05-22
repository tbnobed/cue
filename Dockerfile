FROM node:24-alpine AS base
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

# ─── Production image ────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && apk add --no-cache curl

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
COPY scripts/package.json scripts/
COPY scripts/tsconfig.json scripts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# Copy built outputs
COPY --from=base /app/artifacts/api-server/dist artifacts/api-server/dist
COPY --from=base /app/artifacts/studio-pm/dist artifacts/studio-pm/dist
COPY --from=base /app/lib/api-zod/src/generated lib/api-zod/src/generated
COPY --from=base /app/lib/db/src lib/db/src

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
