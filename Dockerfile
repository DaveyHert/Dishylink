# Browser-only Dishylink: SPA + historian + LAN/cloud proxies.
# linux/arm64 for Apple Silicon. The host Mac must be on the Starlink LAN —
# Docker Desktop has no real --network host, so the container reaches the dish
# and router through the host's IPv4 NAT.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HISTORIAN_EMBED=1
ENV HISTORIAN_DATA_DIR=/data
ENV HISTORIAN_PROTOSET=/app/public/dish.protoset
ENV BROWSER_DIST=/app/dist
ENV BROWSER_HOST_PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 dishylink \
  && useradd --system --uid 1001 --gid dishylink --home-dir /app --no-create-home dishylink \
  && mkdir -p /data \
  && chown dishylink:dishylink /data

# Runtime only needs the historian's protobuf decoder and tsx to load the .mts
# tree. A stub package.json keeps those files ESM; the monorepo lockfile is
# not reused here because it would pull Electron and the renderer into the image.
RUN printf '%s\n' '{"name":"dishylink-browser","private":true,"type":"module"}' > package.json \
  && npm install --omit=dev --ignore-scripts @bufbuild/protobuf@2.6.0 tsx@4.23.1

COPY --from=build --chown=dishylink:dishylink /app/dist ./dist
COPY --from=build --chown=dishylink:dishylink /app/public/dish.protoset ./public/dish.protoset
COPY --chown=dishylink:dishylink collector ./collector
COPY --chown=dishylink:dishylink core ./core
COPY --chown=dishylink:dishylink cloud ./cloud
COPY --chown=dishylink:dishylink docker ./docker
COPY --chown=dishylink:dishylink dev/starlinkCloudProxy.ts ./dev/starlinkCloudProxy.ts

USER dishylink
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "docker/browserHost.mts"]
