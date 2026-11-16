FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN npm install --global pnpm@10.11.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY vite.config.ts ./
COPY web ./web
RUN pnpm run build && pnpm prune --prod \
    && chmod -R a+rX node_modules web/dist
ARG RELEASE_ID=development
ARG SOURCE_SHA=unknown
RUN node --input-type=module -e 'import {writeFileSync} from "node:fs"; writeFileSync("web/dist/release.json", JSON.stringify({release:process.env.RELEASE_ID,sourceSha256:process.env.SOURCE_SHA,builtAt:new Date().toISOString()})+"\n")'

FROM node:24-bookworm-slim AS runtime
ARG RELEASE_ID=development
ARG SOURCE_SHA=unknown
LABEL org.opencontainers.image.version=$RELEASE_ID \
    org.opencontainers.image.revision=$SOURCE_SHA
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7717 \
    BANXUE_DATA_DIR=/data \
    TZ=Asia/Shanghai
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/web/src/shared ./web/src/shared
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/admin-account.mjs ./scripts/admin-account.mjs
RUN chmod -R a+rX /app/server && chmod a+r /app/package.json \
    && mkdir /data && chown node:node /data
USER node
EXPOSE 7717
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(3000)});if(!r.ok||!(await r.json()).ok)process.exit(1)"]
CMD ["node", "server/index.mjs", "--static"]
