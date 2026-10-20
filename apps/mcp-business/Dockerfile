# One image, two servers: Helm selects utility or analytics via the command.

# Stage 1: Install dependencies and compile TypeScript
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp-business/package.json ./apps/mcp-business/

RUN npm ci --workspace=mcp-business --include-workspace-root=false

COPY apps/mcp-business/tsconfig.json ./apps/mcp-business/
COPY apps/mcp-business/src ./apps/mcp-business/src

RUN npm run build --workspace=mcp-business


# Stage 2: Production runtime
FROM node:24-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3002

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp-business/package.json ./apps/mcp-business/

RUN npm ci --workspace=mcp-business \
    --include-workspace-root=false \
    --omit=dev \
    && npm cache clean --force

COPY --from=builder /app/apps/mcp-business/dist \
    ./apps/mcp-business/dist

USER node

EXPOSE 3002

CMD ["node", "apps/mcp-business/dist/utility/main.js"]
