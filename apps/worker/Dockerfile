FROM node:20-alpine AS base
RUN npm install -g pnpm@9 turbo

FROM base AS builder
WORKDIR /app
COPY . .
RUN turbo prune --scope=worker --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=builder /app/out/full/ .
COPY tsconfig.base.json ./
RUN pnpm --filter @autarb/db generate
RUN turbo build --filter=worker

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=installer /app/ .
EXPOSE 3001
CMD ["node", "apps/worker/dist/index.js"]
