# Operations-only image: never receives public ingress or application requests.
FROM node:24-bookworm-slim AS node
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY scripts/backup/supabase.mjs /backup/supabase.mjs
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/AdvaitR7/ClinixAI"
USER postgres
ENTRYPOINT []
CMD ["sleep", "infinity"]
