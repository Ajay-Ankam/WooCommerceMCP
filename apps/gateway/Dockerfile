# Gateway + dashboard in one image: the gateway serves the built React app on
# the same origin as /api, /mcp and /invite/*, so cookies need no CORS.
# Build from the repository root:
#   docker build -f apps/gateway/Dockerfile -t ajay-gateway:dev .

# Stage 1: Install dependencies and build both workspaces
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/dashboard/package.json ./apps/dashboard/

# The root workspace provides TypeScript and Express.
RUN npm ci --workspace=@project-ajay/gateway --workspace=@project-ajay/dashboard \
    --include-workspace-root

COPY apps/gateway/tsconfig.json ./apps/gateway/
COPY apps/gateway/src ./apps/gateway/src
COPY apps/dashboard ./apps/dashboard

RUN npm run build --workspace=@project-ajay/gateway \
    && npm run build --workspace=@project-ajay/dashboard


# Stage 2: Production runtime
FROM node:24-alpine

ENV NODE_ENV=production
ENV PORT=3000
# SQLite lives on a mounted volume, never in the image layer.
ENV GATEWAY_DB_PATH=/data/gateway.db
ENV DASHBOARD_DIR=/app/apps/dashboard/dist

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/gateway/package.json ./apps/gateway/

RUN npm ci --workspace=@project-ajay/gateway --include-workspace-root --omit=dev \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown node:node /data

COPY --from=builder /app/apps/gateway/dist ./apps/gateway/dist
COPY --from=builder /app/apps/dashboard/dist ./apps/dashboard/dist

USER node

VOLUME ["/data"]

EXPOSE 3000

# Paths are relative to the gateway workspace, like `npm start`.
WORKDIR /app/apps/gateway

CMD ["node", "dist/index.js"]
