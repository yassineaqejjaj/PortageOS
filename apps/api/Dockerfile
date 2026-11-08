# Build depuis la racine du monorepo : docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile --filter @portage/api... \
 && pnpm -F @portage/domain build \
 && pnpm -F @portage/api exec prisma generate \
 && pnpm -F @portage/api build

FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
USER node
EXPOSE 3001
# Migrations (propriétaire) puis API (rôle portage_app, soumis au RLS). Voir docs/DEPLOYMENT.md.
CMD ["sh", "-c", "pnpm -F @portage/api exec prisma migrate deploy && node apps/api/dist/bootstrap-db.js && node apps/api/dist/main.js"]
