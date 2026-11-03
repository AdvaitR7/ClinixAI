# CliniX API (Fastify, run with tsx like local dev). Build from the repository root:
#   docker build -f services/api/Dockerfile -t clinix-api .
FROM node:24-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY services/api/package.json services/api/package.json
COPY services/worker/package.json services/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci --omit=dev --workspace @clinix/api

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    PORT=4000
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY --chown=node:node services/api ./services/api
USER node
WORKDIR /repo/services/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>r.json()).then(b=>process.exit(b.db==='up'?0:1)).catch(()=>process.exit(1))"
# Run node directly (not via npm) so SIGTERM reaches the process and it can stop gracefully.
CMD ["node", "--import", "tsx", "src/index.ts"]
