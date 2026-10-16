FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
ARG OPENROUND_BUILD_ID=development
RUN printf '%s\n' "$OPENROUND_BUILD_ID" > /app/BUILD_ID
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/control/package.json apps/control/package.json
COPY packages/control-plane/package.json packages/control-plane/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/experience/package.json packages/experience/package.json
COPY packages/insights/package.json packages/insights/package.json
RUN pnpm install --frozen-lockfile
COPY apps/control apps/control
COPY packages/control-plane packages/control-plane
COPY packages/db packages/db
COPY packages/contracts packages/contracts
COPY packages/game-engine packages/game-engine
COPY packages/experience packages/experience
COPY packages/insights packages/insights
RUN pnpm --filter @openround/control build
COPY tsup.admin.config.ts ./
RUN pnpm admin:build

FROM node:22-alpine AS runtime
RUN addgroup -S pollingpops && adduser -S pollingpops -G pollingpops
WORKDIR /app
COPY --from=build --chown=pollingpops:pollingpops /app/apps/control/.next/standalone ./
COPY --from=build --chown=pollingpops:pollingpops /app/apps/control/.next/static ./apps/control/.next/static
COPY --from=build /app/BUILD_ID /app/BUILD_ID
COPY --from=build --chown=pollingpops:pollingpops /app/apps/control/admin-dist/admin-cli.mjs /app/admin-cli.mjs
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3002
USER pollingpops
EXPOSE 3002
CMD ["node", "apps/control/server.js"]
