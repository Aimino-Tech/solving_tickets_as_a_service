# Stage 1: Build
FROM node:22-alpine AS build

# Use BuildKit cache mounts for faster rebuilds
WORKDIR /app

# Install dependencies (layer caching — only invalidated when lockfile changes)
# IMPORTANT: Do NOT COPY .env or any secrets into the image
# Secrets are injected at runtime via environment variables or Docker secrets
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

# Build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Build dashboard (if it exists)
COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
COPY dashboard/ ./dashboard/
RUN cd dashboard && npm ci --ignore-scripts && npm run build

# Prune dev dependencies (keep only what's needed at runtime)
RUN npm prune --production

# Stage 2: Runtime
FROM node:22-alpine

# Security: upgrade all system packages to fix known CVEs
RUN apk upgrade --no-cache

# SHELL hardening: ensure pipefail is set for all RUN commands
SHELL ["/bin/sh", "-o", "pipefail", "-c"]

# Create non-root user for security
RUN addgroup -S stas && adduser -S stas -G stas

WORKDIR /app

# Copy only what's needed at runtime — with correct ownership
COPY --from=build --chown=stas:stas /app/dist ./dist
COPY --from=build --chown=stas:stas /app/node_modules ./node_modules
COPY --from=build --chown=stas:stas /app/package.json ./
COPY --from=build --chown=stas:stas /app/dashboard/dist ./dashboard/dist

USER stas

EXPOSE 3000

# Run with read-only root filesystem in production:
#   docker run --read-only --tmpfs /tmp --tmpfs /app/data ...
# This prevents the container from writing to the filesystem,
# limiting the impact of a compromised process.

STOPSIGNAL SIGTERM

# Healthcheck — uses Node 22's built-in fetch to hit the /health endpoint
# Interval: how often to check (30s)
# Timeout: max time for a single check (3s)
# Start-period: grace period before first check (5s)
# Retries: consecutive failures before marking unhealthy (3)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]

LABEL maintainer="STAS Team"
LABEL description="Solving Tickets As A Service — GitHub bot that turns labeled issues into pull requests"
LABEL org.opencontainers.image.source="https://github.com/tamnguyen08/solving_tickets_as_a_service"

CMD ["node", "dist/index.js"]
