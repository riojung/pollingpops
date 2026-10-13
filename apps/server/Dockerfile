FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/control-plane/package.json packages/control-plane/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/experience/package.json packages/experience/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/insights/package.json packages/insights/package.json
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY packages packages
RUN pnpm --filter @openround/server build
RUN pnpm --filter @openround/server deploy --prod --legacy /prod/server
ARG OPENROUND_BUILD_ID=unversioned
RUN printf '%s\n' "$OPENROUND_BUILD_ID" > /app/BUILD_ID

FROM node:22-alpine AS runtime
RUN addgroup -S openround && adduser -S openround -G openround
WORKDIR /app
COPY --from=build /prod/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/packages/db/migrations ./migrations
COPY --from=build /app/BUILD_ID ./BUILD_ID
COPY --from=build /prod/server/package.json ./package.json
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/
ENV NODE_ENV=production
USER openround
EXPOSE 4000
CMD ["node", "dist/index.js"]
