# Build context is the repository root (the server reuses ../src/core): docker build -f server/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
COPY src/core ../src/core
COPY src/services/backend/demoSeed.ts ../src/services/backend/demoSeed.ts
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/migrations ./migrations
COPY --from=build /app/server/package.json ./
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 4000
CMD ["node", "dist/server/src/index.js"]
