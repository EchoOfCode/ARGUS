# ARGUS WhatsApp Bridge — TypeScript / Baileys Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# ─── Production Runner ──────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Create persistent storage directories
RUN mkdir -p /app/auth_info

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
