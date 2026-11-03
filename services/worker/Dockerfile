# CliniX worker (pg-boss: document extraction and AI analysis). Build from the repository root:
#   docker build -f services/worker/Dockerfile -t clinix-worker .
# The worker imports the API schema and crypto modules, so the API sources ship in the image too.
FROM node:24-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
COPY services/worker/package.json services/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci --omit=dev --workspace @clinix/worker

FROM node:24-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/api ./services/api
COPY --chown=node:node services/worker ./services/worker
USER node
WORKDIR /repo/services/worker
CMD ["npm", "run", "start"]
