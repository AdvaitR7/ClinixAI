# CliniX web (Next.js standalone). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t clinix-web \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... --build-arg NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL=... .
FROM node:24-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY services/api/package.json services/api/package.json
COPY services/worker/package.json services/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
RUN npm ci --workspace @clinix/web

FROM node:24-slim AS build
WORKDIR /repo
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so they are build args.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL
ARG ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL=$NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN if [ -n "$ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT" ]; then \
      mkdir -p apps/web/public/.well-known && \
      node -e 'const fs=require("node:fs"); const fingerprint=process.argv[1].split(",").map((value)=>value.trim()).filter(Boolean); if (!fingerprint.length) process.exit(2); fs.writeFileSync("apps/web/public/.well-known/assetlinks.json", JSON.stringify([{relation:["delegate_permission/common.handle_all_urls"],target:{namespace:"android_app",package_name:"com.clinixai.app",sha256_cert_fingerprints:fingerprint}}]));' "$ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT"; \
    fi
# `next build && serwist build`: emits the standalone server and public/sw.js.
RUN npm run build --workspace @clinix/web

FROM node:24-slim AS runtime
WORKDIR /repo
LABEL org.opencontainers.image.source="https://github.com/AdvaitR7/ClinixAI"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
