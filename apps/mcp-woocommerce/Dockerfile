
# Stage 1: Install dependencies and compile TypeScript
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp-woocommerce/package.json ./apps/mcp-woocommerce/

RUN npm ci --workspace=mcp-woocommerce --include-workspace-root=false

COPY apps/mcp-woocommerce/tsconfig.json ./apps/mcp-woocommerce/
COPY apps/mcp-woocommerce/src ./apps/mcp-woocommerce/src

RUN npm run build --workspace=mcp-woocommerce


# Stage 2: Production runtime
FROM node:24-alpine

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/mcp-woocommerce/package.json ./apps/mcp-woocommerce/

RUN npm ci --workspace=mcp-woocommerce \
    --include-workspace-root=false \
    --omit=dev \
    && npm cache clean --force

COPY --from=builder /app/apps/mcp-woocommerce/dist \
    ./apps/mcp-woocommerce/dist

USER node

EXPOSE 3001

CMD ["node", "apps/mcp-woocommerce/dist/http.js"]
