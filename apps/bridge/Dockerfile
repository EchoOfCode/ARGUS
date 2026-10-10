# ARGUS WhatsApp Bridge — Multi-stage Non-root Dockerfile
# Stage 1: Build & Compile TypeScript
FROM node:20.18-alpine AS builder

WORKDIR /build

# Build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# Stage 2: Minimal production runner
FROM node:20.18-alpine AS runner

WORKDIR /app

# Runtime dependency for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /build/dist ./dist

# Create persistent storage directories with non-root ownership
RUN mkdir -p /app/auth_info /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ps aux | grep -v grep | grep "[n]ode" || exit 1

# Production runner (not npm run dev)
CMD ["node", "dist/index.js"]
