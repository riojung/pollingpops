FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/experience/package.json packages/experience/package.json
COPY packages/game-engine/package.json packages/game-engine/package.json
COPY packages/insights/package.json packages/insights/package.json
COPY packages/rehearsal/package.json packages/rehearsal/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/experience packages/experience
COPY packages/game-engine packages/game-engine
COPY packages/insights packages/insights
COPY packages/rehearsal packages/rehearsal
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG OPENROUND_BUILD_ID=unversioned
RUN printf '%s\n' "$OPENROUND_BUILD_ID" > /app/BUILD_ID
RUN pnpm --filter @openround/web build

FROM node:22-alpine AS runtime
# Runtime entry points use Node directly; package managers are build-only tools.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S openround && adduser -S openround -G openround
WORKDIR /app
COPY --from=build --chown=openround:openround /app/apps/web/.next/standalone ./
COPY --from=build --chown=openround:openround /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=openround:openround /app/apps/web/public ./apps/web/public
COPY --from=build --chown=openround:openround /app/BUILD_ID ./BUILD_ID
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
USER openround
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
