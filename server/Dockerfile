# VolleyLive API image. Build context is the REPOSITORY ROOT (the server reuses ../src/core):
#   docker build -f server/Dockerfile -t volleylive-api .
# Configuration comes only from environment variables at run time (see server/.env.example);
# nothing secret is baked into the image (.dockerignore drops env files and signing material).
FROM node:20-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
COPY src/core ../src/core
COPY src/services/backend/demoSeed.ts ../src/services/backend/demoSeed.ts
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=/data/uploads
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/docker/start.sh ./start.sh
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 4000
# Liveness inside the container; platforms should use GET /health (database ping) for readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run on every start (idempotent, locked); see docker/start.sh.
CMD ["sh", "./start.sh"]
