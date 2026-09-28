FROM node:24-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
ARG NEXT_PUBLIC_DOCUMENTS_COLLAB_URL
ENV NEXT_PUBLIC_DOCUMENTS_COLLAB_URL=${NEXT_PUBLIC_DOCUMENTS_COLLAB_URL}

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
RUN yarn install

COPY . .
RUN yarn generate
RUN NODE_ENV=production yarn build

FROM node:24-alpine AS dev

ENV NODE_ENV=development \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal

WORKDIR /app

RUN apk add --no-cache python3 make g++ ca-certificates openssl
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
RUN yarn install

COPY . .

COPY docker/scripts/dev-entrypoint.sh /app/docker/scripts/dev-entrypoint.sh
COPY docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
COPY docker/scripts/mcp-entrypoint.sh /app/docker/scripts/mcp-entrypoint.sh
RUN chmod +x /app/docker/scripts/dev-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/mcp-entrypoint.sh

EXPOSE 3000 4101
CMD ["/bin/sh", "/app/docker/scripts/dev-entrypoint.sh"]

FROM node:24-alpine AS runner

ARG CONTAINER_PORT=3000
ARG DOCUMENTS_COLLAB_PORT=4101
ARG OPEN_MERCATO_DOCKER_REGISTRY_HOST=host.docker.internal
# Chromium backs the Documents PDF export (puppeteer-core). Build with
# --build-arg INSTALL_CHROMIUM=1 to include it; PDF export otherwise returns 503.
ARG INSTALL_CHROMIUM=0

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH \
    PORT=${CONTAINER_PORT} \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

RUN if [ "$INSTALL_CHROMIUM" = "1" ]; then \
      apk add --no-cache ca-certificates chromium openssl; \
    else \
      apk add --no-cache ca-certificates openssl; \
    fi
RUN corepack enable

# Created before anything is installed, so ownership can be fixed inside the
# install layer below. A trailing `chown -R omuser:omuser /app` instead rewrites
# every installed file, and copy-on-write turns that into a second full copy of
# node_modules — measured at 2.5 GB against a 2.3 GB /app.
RUN adduser -D -u 1001 omuser

COPY package.json yarn.lock .yarnrc.yml ./
RUN if grep -Eq 'http://(localhost|127\\.0\\.0\\.1):' .yarnrc.yml; then \
      sed \
        -e "s#http://localhost:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        -e "s#http://127.0.0.1:#http://${OPEN_MERCATO_DOCKER_REGISTRY_HOST}:#g" \
        .yarnrc.yml > .yarnrc.yml.container; \
      if ! grep -Eq '^checksumBehavior:' .yarnrc.yml.container; then \
        printf '\nchecksumBehavior: update\n' >> .yarnrc.yml.container; \
      fi; \
      mv .yarnrc.yml.container .yarnrc.yml; \
    fi
# All three share one layer on purpose: the install is what creates both the
# 1.3 GB global cache and the files that need re-owning, and splitting them into
# later RUNs persists the cache and a duplicate of every file in the image.
RUN yarn workspaces focus --all --production \
 && yarn cache clean \
 && chown -R omuser:omuser /app

COPY --chown=omuser:omuser --from=builder /app/.mercato/next ./.mercato/next
COPY --chown=omuser:omuser --from=builder /app/public ./public
COPY --chown=omuser:omuser --from=builder /app/src ./src
COPY --chown=omuser:omuser --from=builder /app/types ./types
COPY --chown=omuser:omuser --from=builder /app/.mercato ./.mercato
COPY --chown=omuser:omuser --from=builder /app/next.config.ts ./next.config.ts
COPY --chown=omuser:omuser --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --chown=omuser:omuser --from=builder /app/components.json ./components.json
COPY --chown=omuser:omuser --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=omuser:omuser --from=builder /app/scripts ./scripts
COPY --chown=omuser:omuser docker/scripts/init-or-migrate.sh /app/docker/scripts/init-or-migrate.sh
# Used by the optional `mcp` service (compose profile `agents`).
COPY --chown=omuser:omuser docker/scripts/mcp-entrypoint.sh /app/docker/scripts/mcp-entrypoint.sh
RUN chmod +x /app/docker/scripts/init-or-migrate.sh
RUN chmod +x /app/docker/scripts/mcp-entrypoint.sh

USER omuser

EXPOSE ${CONTAINER_PORT} ${DOCUMENTS_COLLAB_PORT}
CMD ["yarn", "start"]
