FROM oven/bun:1.3.14-debian AS base

FROM base AS dependencies
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build:web && bun run build:server

FROM base AS runtime
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3000
ENV WEB_ROOT=/app/apps/web/dist

COPY --from=build --chown=bun:bun /app/dist/server ./dist/server
COPY --from=build --chown=bun:bun /app/apps/web/dist ./apps/web/dist

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "process.exit((await fetch('http://127.0.0.1:3000/healthz')).ok ? 0 : 1)"

CMD ["bun", "dist/server/index.js"]
