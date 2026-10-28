# Multi-stage non-root Dockerfile for Rocket Track Cloud
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules (if better-sqlite3 is compiled)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --include=dev

COPY . .
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache python3 make g++

# Create non-root group and user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm install --omit=dev && npm install tsx typescript

# Copy server code, shared types, tools, and compiled frontend
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tools ./tools
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Give appuser ownership of workspace
RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "--loader", "tsx", "server.ts"]
